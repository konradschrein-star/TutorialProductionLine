import { eq, desc, sql, and } from 'drizzle-orm';
import { db, users } from '../db';

/**
 * Team Repository
 *
 * Data access layer for team management and VA productivity tracking.
 */

export interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface UserWithStats extends User {
  jobs_completed: number;
  jobs_in_progress: number;
  jobs_working_now: number;
  avg_time_per_job_hours: number | null;
  online_seconds_total: number;
  last_seen_at: Date | null;
  is_online: boolean;
}

/**
 * List all users with job statistics
 *
 * @returns Array of users with job stats
 */
export async function listUsersWithStats(): Promise<UserWithStats[]> {
  const result = await db
    .select({
      user: users,
      jobs_completed: sql<number>`
        cast(count(CASE WHEN tj.status = 'COMPLETED' THEN 1 END) as integer)
      `,
      jobs_in_progress: sql<number>`
        cast(count(CASE WHEN tj.id IS NOT NULL AND tj.status NOT IN
          ('COMPLETED', 'FAILED_SCRIPT', 'FAILED_AUDIO', 'FAILED_SPLICE', 'CANCELLED')
          THEN 1 END) as integer)
      `,
      jobs_working_now: sql<number>`
        cast(count(CASE WHEN tj.status IN
          ('GENERATING_SCRIPT', 'GENERATING_AUDIO', 'READY_TO_RECORD', 'AWAITING_UPLOAD', 'SPLICING')
          THEN 1 END) as integer)
      `,
      avg_time_hours: sql<number | null>`
        avg(EXTRACT(EPOCH FROM (tj.updated_at - tj.created_at)) / 3600)
      `,
    })
    .from(users)
    .leftJoin(
      sql`tutorial_jobs tj`,
      sql`${users.id} = tj.created_by`
    )
    .groupBy(users.id)
    .orderBy(desc(users.created_at));

  return result.map((row: any) => ({
    ...row.user,
    jobs_completed: row.jobs_completed || 0,
    jobs_in_progress: row.jobs_in_progress || 0,
    jobs_working_now: row.jobs_working_now || 0,
    avg_time_per_job_hours: row.avg_time_hours != null ? Number(row.avg_time_hours) : null,
    online_seconds_total: Number(row.user.online_seconds_total ?? 0),
    last_seen_at: row.user.last_seen_at ?? null,
    is_online:
      row.user.last_seen_at instanceof Date &&
      Date.now() - row.user.last_seen_at.getTime() < 2 * 60 * 1000,
  }));
}

/**
 * Get VA productivity metrics
 *
 * @param role - Filter by role (PRODUCTION_VA or UPLOADER_VA)
 * @returns Array of users with productivity metrics
 */
export async function getVAProductivity(
  role?: 'PRODUCTION_VA' | 'UPLOADER_VA'
): Promise<UserWithStats[]> {
  const allUsers = await listUsersWithStats();

  if (role) {
    return allUsers.filter((user) => user.role === role);
  }

  return allUsers.filter(
    (user) => user.role === 'PRODUCTION_VA' || user.role === 'UPLOADER_VA'
  );
}

/**
 * List active users by role
 *
 * @param role - Role to filter by
 * @returns Array of active users with that role
 */
export async function listActiveUsersByRole(
  role: 'PRODUCTION_VA' | 'UPLOADER_VA' | 'ADMIN' | 'MANAGER' | 'VIEWER'
): Promise<Array<{ id: string; name: string; email: string }>> {
  const result = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(and(eq(users.role, role), eq(users.is_active, true)))
    .orderBy(users.name);
  return result;
}

/**
 * Get user by ID
 *
 * @param id - User ID
 * @returns User or null if not found
 */
export async function getUserById(id: string): Promise<User | null> {
  const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return result.length > 0 ? result[0] : null;
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
  role: string;
  password_hash: string;
}): Promise<User> {
  const result = await db
    .insert(users)
    .values({
      email: data.email,
      name: data.name,
      role: data.role as any,
      passwordHash: data.password_hash,
      is_active: true,
    })
    .returning();

  return result[0];
}

/**
 * Update user
 *
 * @param id - User ID
 * @param data - Updated user data
 * @returns Updated user or null if not found
 */
export async function updateUser(
  id: string,
  data: Partial<{
    email: string;
    name: string;
    role: string;
  }>
): Promise<User | null> {
  const updateData: any = {
    ...data,
    updated_at: new Date(),
  };

  const result = await db
    .update(users)
    .set(updateData)
    .where(eq(users.id, id))
    .returning();

  return result.length > 0 ? result[0] : null;
}

/**
 * Toggle user active status
 *
 * @param id - User ID
 * @param is_active - New active status
 * @returns Updated user or null if not found
 */
export async function toggleUserActive(
  id: string,
  is_active: boolean
): Promise<User | null> {
  const result = await db
    .update(users)
    .set({
      is_active,
      updated_at: new Date(),
    })
    .where(eq(users.id, id))
    .returning();

  return result.length > 0 ? result[0] : null;
}

/**
 * Delete user
 *
 * @param id - User ID
 * @returns True if deleted, false if not found
 */
export async function deleteUser(id: string): Promise<boolean> {
  await db.delete(users).where(eq(users.id, id));
  return true;
}
