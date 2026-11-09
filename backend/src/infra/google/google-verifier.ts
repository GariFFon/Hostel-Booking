import { OAuth2Client } from 'google-auth-library';
import { env } from '@/core/config/env';
import { AppError, Errors } from '@/core/errors/app-error';

export interface GoogleIdentity {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
}

export type GoogleVerifier = (idToken: string) => Promise<GoogleIdentity>;

let client: OAuth2Client | undefined;

/** Verifies a Google ID token (from web or Flutter) against the configured OAuth client IDs. */
export const verifyGoogleIdToken: GoogleVerifier = async (idToken) => {
  const audiences = env().GOOGLE_CLIENT_IDS;
  if (audiences.length === 0) {
    throw new AppError('DEPENDENCY_UNAVAILABLE', 'Google sign-in is not configured on this server');
  }
  client ??= new OAuth2Client();
  try {
    const ticket = await client.verifyIdToken({ idToken, audience: audiences });
    const p = ticket.getPayload();
    if (!p?.sub || !p.email) throw new Error('incomplete payload');
    return { sub: p.sub, email: p.email.toLowerCase(), emailVerified: p.email_verified === true, name: p.name ?? null, picture: p.picture ?? null };
  } catch {
    throw Errors.unauthenticated('Invalid Google credential');
  }
};
