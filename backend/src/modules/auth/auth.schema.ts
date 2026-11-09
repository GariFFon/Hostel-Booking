import { z } from 'zod';
import { passwordSchema } from '@/core/auth/password';

const email = z.string().trim().toLowerCase().max(254).pipe(z.email('Enter a valid email address'));
const phone = z.string().trim().regex(/^\+?[1-9]\d{7,14}$/, 'Enter a phone number in international format').optional();
const fullName = z.string().trim().min(2, 'Name is too short').max(100);

export const registerSchema = z.object({
  email,
  password: passwordSchema,
  fullName,
  phone,
  /** Self-service roles only; ADMIN is never assignable via the API. */
  role: z.enum(['GUEST', 'OWNER']).default('GUEST'),
});

export const loginSchema = z.object({ email, password: z.string().min(1).max(128) });
export const refreshSchema = z.object({ refreshToken: z.string().min(20).max(200) });
export const logoutSchema = z.object({ refreshToken: z.string().min(20).max(200) });
export const verifyEmailSchema = z.object({ token: z.string().min(20).max(200) });
export const resendVerificationSchema = z.object({ email });
export const forgotPasswordSchema = z.object({ email });
export const resetPasswordSchema = z.object({ token: z.string().min(20).max(200), password: passwordSchema });
export const googleSchema = z.object({ idToken: z.string().min(20), role: z.enum(['GUEST', 'OWNER']).default('GUEST') });
export const changePasswordSchema = z.object({ currentPassword: z.string().min(1).max(128), newPassword: passwordSchema });

export const userDtoSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  fullName: z.string().nullable(),
  phone: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  roles: z.array(z.enum(['GUEST', 'OWNER', 'ADMIN'])),
  emailVerified: z.boolean(),
  hasPassword: z.boolean(),
  googleLinked: z.boolean(),
  kycStatus: z.enum(['NOT_SUBMITTED', 'PENDING', 'APPROVED', 'REJECTED']).nullable(),
});

export const authResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  tokenType: z.literal('Bearer'),
  expiresIn: z.number().int(),
  user: userDtoSchema,
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type UserDto = z.infer<typeof userDtoSchema>;
export type AuthResponse = z.infer<typeof authResponseSchema>;
