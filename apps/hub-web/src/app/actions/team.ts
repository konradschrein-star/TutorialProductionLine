'use server';

import { revalidatePath } from 'next/cache';
import {
  createUser as createUserRepo,
  updateUser as updateUserRepo,
  toggleUserActive as toggleUserActiveRepo,
  deleteUser as deleteUserRepo,
} from '@/lib/repositories/team-repository';
import { hashPassword } from '@/lib/auth/password';
import { getSession } from '@/lib/auth/session';
import { hasPermission } from '@/lib/auth/rbac';

export interface ActionResult {
  success: boolean;
  error?: string;
}

/**
 * Create a new user
 *
 * @param data - User data with plaintext password
 * @returns ActionResult
 */
export async function createUser(data: {
  email: string;
  name: string;
  role: string;
  password: string;
}): Promise<ActionResult> {
  try {
    const session = await getSession();
    if (!session || !hasPermission(session, 'create:user')) {
      return { success: false, error: 'Unauthorized' };
    }

    // Hash password
    const password_hash = await hashPassword(data.password);

    // Create user
    await createUserRepo({
      email: data.email,
      name: data.name,
      role: data.role,
      password_hash,
    });

    revalidatePath('/team');

    return { success: true };
  } catch (error) {
    console.error('Failed to create user:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Update an existing user
 *
 * @param id - User ID
 * @param data - Updated user data
 * @returns ActionResult
 */
export async function updateUser(
  id: string,
  data: {
    email: string;
    name: string;
    role: string;
    password?: string;
  }
): Promise<ActionResult> {
  try {
    const session = await getSession();
    if (!session || !hasPermission(session, 'edit:user')) {
      return { success: false, error: 'Unauthorized' };
    }

    const password = data.password?.trim();
    if (password && password.length < 12) {
      return { success: false, error: 'Replacement passwords must be at least 12 characters.' };
    }
    const user = await updateUserRepo(id, {
      email: data.email,
      name: data.name,
      role: data.role,
      ...(password ? { passwordHash: await hashPassword(password) } : {}),
    });

    if (!user) {
      return { success: false, error: 'User not found' };
    }

    revalidatePath('/team');
    revalidatePath(`/team/${id}`);

    return { success: true };
  } catch (error) {
    console.error('Failed to update user:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Toggle user active status
 *
 * @param id - User ID
 * @param is_active - New active status
 * @returns ActionResult
 */
export async function toggleUserActive(
  id: string,
  is_active: boolean
): Promise<ActionResult> {
  try {
    const session = await getSession();
    if (!session || !hasPermission(session, 'edit:user')) {
      return { success: false, error: 'Unauthorized' };
    }

    const user = await toggleUserActiveRepo(id, is_active);

    if (!user) {
      return { success: false, error: 'User not found' };
    }

    revalidatePath('/team');

    return { success: true };
  } catch (error) {
    console.error('Failed to toggle user active:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Delete a user
 *
 * @param id - User ID
 * @returns ActionResult
 */
export async function deleteUser(id: string): Promise<ActionResult> {
  try {
    const session = await getSession();
    if (!session || !hasPermission(session, 'delete:user')) {
      return { success: false, error: 'Unauthorized' };
    }

    // Prevent deleting self
    if (session.userId === id) {
      return { success: false, error: 'Cannot delete yourself' };
    }

    const deleted = await deleteUserRepo(id);

    if (!deleted) {
      return { success: false, error: 'User not found' };
    }

    revalidatePath('/team');

    return { success: true };
  } catch (error) {
    console.error('Failed to delete user:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
