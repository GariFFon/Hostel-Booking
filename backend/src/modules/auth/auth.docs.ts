import { z } from 'zod';
import { documentRoute } from '@/core/openapi/registry';
import { updateProfileSchema } from '@/modules/users/users.schema';
import {
  authResponseSchema, changePasswordSchema, forgotPasswordSchema, googleSchema, loginSchema, logoutSchema,
  refreshSchema, registerSchema, resendVerificationSchema, resetPasswordSchema, userDtoSchema, verifyEmailSchema,
} from './auth.schema';

const T = ['Auth'];
const flag = (k: string) => z.object({ [k]: z.boolean() });

documentRoute({ method: 'post', path: '/auth/register', summary: 'Create an account (guest or owner)', tags: T, body: registerSchema, response: authResponseSchema, status: 201, errors: [409] });
documentRoute({ method: 'post', path: '/auth/login', summary: 'Sign in with email and password', tags: T, body: loginSchema, response: authResponseSchema, errors: [401] });
documentRoute({ method: 'post', path: '/auth/refresh', summary: 'Rotate the refresh token and get a new access token (serialise calls client-side)', tags: T, body: refreshSchema, response: authResponseSchema, errors: [401] });
documentRoute({ method: 'post', path: '/auth/logout', summary: 'Revoke a refresh-token family (idempotent)', tags: T, body: logoutSchema, response: flag('loggedOut') });
documentRoute({ method: 'post', path: '/auth/logout-all', summary: 'Sign out of every device', tags: T, auth: true, response: flag('loggedOut') });
documentRoute({ method: 'post', path: '/auth/verify-email', summary: 'Confirm an email address with the emailed token', tags: T, body: verifyEmailSchema, response: flag('verified') });
documentRoute({ method: 'post', path: '/auth/resend-verification', summary: 'Resend the verification email (same response for unknown emails)', tags: T, body: resendVerificationSchema, response: flag('sent') });
documentRoute({ method: 'post', path: '/auth/forgot-password', summary: 'Request a password-reset email (same response for unknown emails)', tags: T, body: forgotPasswordSchema, response: flag('sent') });
documentRoute({ method: 'post', path: '/auth/reset-password', summary: 'Set a new password with the emailed token', tags: T, body: resetPasswordSchema, response: flag('reset') });
documentRoute({ method: 'post', path: '/auth/google', summary: 'Sign in / up with a Google ID token (web or mobile)', tags: T, body: googleSchema, response: authResponseSchema, errors: [401, 503] });
documentRoute({ method: 'get', path: '/me', summary: 'Current user', tags: ['Me'], auth: true, response: userDtoSchema });
documentRoute({ method: 'patch', path: '/me', summary: 'Update profile', tags: ['Me'], auth: true, body: updateProfileSchema, response: userDtoSchema });
documentRoute({ method: 'post', path: '/me/password', summary: 'Change password (signs out other devices, returns a new session)', tags: ['Me'], auth: true, body: changePasswordSchema, response: authResponseSchema });
documentRoute({ method: 'post', path: '/me/become-owner', summary: 'Add the OWNER role; refresh tokens afterwards', tags: ['Me'], auth: true, response: userDtoSchema, errors: [409] });
