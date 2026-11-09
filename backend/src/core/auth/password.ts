import argon2 from 'argon2';
import { z } from 'zod';

const OPTIONS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const; // OWASP minimum profile

export const hashPassword = (plain: string) => argon2.hash(plain, OPTIONS);

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

// Verified against when the account does not exist, so response time doesn't reveal valid emails.
let dummy: Promise<string> | undefined;
export async function burnPasswordCheck(plain: string) {
  dummy ??= hashPassword('dummy-password-for-timing-equalisation');
  await verifyPassword(await dummy, plain);
}

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters')
  .regex(/[A-Za-z]/, 'Password must contain a letter')
  .regex(/\d/, 'Password must contain a number');
