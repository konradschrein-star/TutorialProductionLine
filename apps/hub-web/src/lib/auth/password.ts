import bcrypt from 'bcryptjs';

/**
 * Password hashing and verification using bcryptjs
 *
 * Uses 10 rounds for a good balance between security and performance.
 * Hashing is intentionally slow to prevent brute-force attacks.
 */

const SALT_ROUNDS = 10;

/**
 * Hash a plaintext password
 *
 * @param password - Plain text password
 * @returns Hashed password suitable for storage
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

/**
 * Verify a password against a stored hash
 *
 * @param password - Plain text password to verify
 * @param hash - Stored password hash
 * @returns true if password matches, false otherwise
 */
export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
