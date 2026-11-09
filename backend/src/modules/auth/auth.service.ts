import { randomUUID } from 'node:crypto';
import { Prisma } from '@/generated/prisma/client';
import { env } from '@/core/config/env';
import { burnPasswordCheck, hashPassword, verifyPassword } from '@/core/auth/password';
import { revokeAccessTokens } from '@/core/auth/revocation';
import { hashToken, newOpaqueToken, signAccessToken } from '@/core/auth/tokens';
import { Errors } from '@/core/errors/app-error';
import { prisma } from '@/infra/db/prisma';
import { verifyGoogleIdToken, type GoogleVerifier } from '@/infra/google/google-verifier';
import { sendMail } from '@/infra/mail/mailer';
import { resetPasswordMail, verifyEmailMail } from '@/infra/mail/templates';
import { recordAudit } from '@/modules/audit/audit.service';
import { toUserDto, type UserWithRelations } from './auth.mapper';
import { authRepository as repo } from './auth.repository';
import type { AuthResponse, RegisterInput } from './auth.schema';

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
const VERIFY_TTL_MS = 24 * 3600_000;
const RESET_TTL_MS = 3600_000;

export interface ClientMeta {
  ip: string | null;
  userAgent: string | null;
}

const actorOf = (u: UserWithRelations) => ({
  id: u.id,
  roles: u.roles.map((r) => r.role),
  emailVerified: u.emailVerifiedAt !== null,
});

function assertUsable(user: UserWithRelations) {
  if (user.status === 'SUSPENDED') throw Errors.forbidden('This account has been suspended. Contact support.');
  if (user.status === 'DELETED') throw Errors.unauthenticated('Invalid email or password');
}

/** Creates a refresh token (new family unless rotating) and a matching access token. */
async function issueSession(user: UserWithRelations, meta: ClientMeta, familyId: string = randomUUID(), tx?: Prisma.TransactionClient) {
  const refreshToken = newOpaqueToken();
  const db = tx ?? prisma;
  const row = await repo.createRefreshToken(db as Prisma.TransactionClient, {
    userId: user.id,
    familyId,
    tokenHash: hashToken(refreshToken),
    expiresAt: new Date(Date.now() + env().REFRESH_TOKEN_TTL_DAYS * 86_400_000),
    userAgent: meta.userAgent,
    ip: meta.ip,
  });
  const { token, expiresIn } = await signAccessToken(actorOf(user));
  const response: AuthResponse = { accessToken: token, refreshToken, tokenType: 'Bearer', expiresIn, user: toUserDto(user) };
  return { response, refreshRowId: row.id };
}

async function createEmailVerification(userId: string): Promise<string> {
  const token = newOpaqueToken();
  await prisma.emailVerificationToken.create({
    data: { userId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + VERIFY_TTL_MS) },
  });
  return token;
}

export const authService = {
  async register(input: RegisterInput, meta: ClientMeta): Promise<AuthResponse> {
    const passwordHash = await hashPassword(input.password);
    let user: UserWithRelations;
    try {
      user = await prisma.$transaction(async (tx) => {
        const created = await repo.createUser(tx, {
          email: input.email, passwordHash, verified: false, fullName: input.fullName, phone: input.phone,
          roles: input.role === 'OWNER' ? ['OWNER', 'GUEST'] : ['GUEST'],
        });
        await recordAudit({ action: 'auth.register', entityType: 'user', entityId: created.id, actorId: created.id, actorRole: input.role, after: { email: created.email, roles: created.roles.map((r) => r.role) } }, tx);
        return created;
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw Errors.conflict('An account with this email already exists');
      }
      throw e;
    }
    const token = await createEmailVerification(user.id);
    await sendMail(verifyEmailMail(user.email, input.fullName, token));
    return (await issueSession(user, meta)).response;
  },

  async login(email: string, password: string, meta: ClientMeta): Promise<AuthResponse> {
    const user = await repo.findUserByEmail(email);
    if (!user || !user.passwordHash) {
      await burnPasswordCheck(password);
      await recordAudit({ action: 'auth.login', entityType: 'user', entityId: user?.id ?? null, outcome: 'FAILURE', actorId: user?.id ?? null, metadata: { email, reason: user ? 'no_password_set' : 'unknown_email' } });
      throw Errors.unauthenticated('Invalid email or password');
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await recordAudit({ action: 'auth.login', entityType: 'user', entityId: user.id, outcome: 'DENIED', actorId: user.id, metadata: { reason: 'locked' } });
      throw Errors.rateLimited(Math.ceil((user.lockedUntil.getTime() - Date.now()) / 1000));
    }
    if (!(await verifyPassword(user.passwordHash, password))) {
      const failed = user.failedLogins + 1;
      const lock = failed >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null;
      await repo.recordFailedLogin(user.id, lock, lock ? 0 : failed);
      await recordAudit({ action: 'auth.login', entityType: 'user', entityId: user.id, outcome: 'FAILURE', actorId: user.id, metadata: { reason: 'bad_password', failedAttempts: failed, locked: Boolean(lock) } });
      throw Errors.unauthenticated('Invalid email or password');
    }
    assertUsable(user);
    const session = await prisma.$transaction(async (tx) => {
      await repo.recordSuccessfulLogin(tx, user.id);
      await recordAudit({ action: 'auth.login', entityType: 'user', entityId: user.id, actorId: user.id, actorRole: user.roles.map((r) => r.role).join(','), metadata: { method: 'password' } }, tx);
      return issueSession(user, meta, undefined, tx);
    });
    return session.response;
  },

  /**
   * Rotates a refresh token. Presenting an already-used token means it was stolen or replayed, so the
   * whole token family is revoked and the user must log in again.
   */
  async refresh(refreshToken: string, meta: ClientMeta): Promise<AuthResponse> {
    const tokenHash = hashToken(refreshToken);
    const now = new Date();
    // Atomic claim: only one concurrent caller can flip revokedAt from null.
    const claimed = await prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null, expiresAt: { gt: now } },
      data: { revokedAt: now },
    });
    const row = await repo.findRefreshToken(tokenHash);
    if (!row) throw Errors.unauthenticated('Invalid refresh token');
    if (claimed.count === 0) {
      if (row.revokedAt) {
        await repo.revokeFamily(row.familyId);
        await recordAudit({ action: 'auth.refresh.reuse_detected', entityType: 'user', entityId: row.userId, outcome: 'DENIED', actorId: row.userId, metadata: { familyId: row.familyId } });
        throw Errors.unauthenticated('Session expired, please sign in again');
      }
      throw Errors.unauthenticated('Session expired, please sign in again');
    }
    const user = await repo.findUserById(row.userId);
    if (!user) throw Errors.unauthenticated('Session expired, please sign in again');
    assertUsable(user);
    const { response, refreshRowId } = await issueSession(user, meta, row.familyId);
    await prisma.refreshToken.update({ where: { id: row.id }, data: { replacedById: refreshRowId } });
    return response;
  },

  async logout(refreshToken: string): Promise<void> {
    const row = await repo.findRefreshToken(hashToken(refreshToken));
    if (!row) return; // idempotent
    await repo.revokeFamily(row.familyId);
    await recordAudit({ action: 'auth.logout', entityType: 'user', entityId: row.userId, actorId: row.userId });
  },

  async logoutAll(userId: string): Promise<void> {
    await repo.revokeAllForUser(userId);
    await revokeAccessTokens(userId);
    await recordAudit({ action: 'auth.logout_all', entityType: 'user', entityId: userId });
  },

  async verifyEmail(token: string): Promise<void> {
    const row = await prisma.emailVerificationToken.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!row || row.consumedAt || row.expiresAt < new Date()) throw Errors.validation(null, 'This verification link is invalid or has expired');
    await prisma.$transaction(async (tx) => {
      await tx.emailVerificationToken.update({ where: { id: row.id }, data: { consumedAt: new Date() } });
      await tx.user.update({ where: { id: row.userId }, data: { emailVerifiedAt: new Date(), status: 'ACTIVE' } });
      await recordAudit({ action: 'auth.email_verified', entityType: 'user', entityId: row.userId, actorId: row.userId }, tx);
    });
    await revokeAccessTokens(row.userId); // next refresh carries emailVerified=true
  },

  async resendVerification(email: string): Promise<void> {
    const user = await repo.findUserByEmail(email);
    if (!user || user.emailVerifiedAt) return; // never reveal account existence
    const token = await createEmailVerification(user.id);
    await sendMail(verifyEmailMail(user.email, user.profile?.fullName ?? 'there', token));
  },

  async forgotPassword(email: string): Promise<void> {
    const user = await repo.findUserByEmail(email);
    if (!user || user.status === 'DELETED') return; // identical response either way
    const token = newOpaqueToken();
    await prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + RESET_TTL_MS) } });
    await recordAudit({ action: 'auth.password.reset_requested', entityType: 'user', entityId: user.id, actorId: user.id });
    await sendMail(resetPasswordMail(user.email, token));
  },

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const row = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!row || row.consumedAt || row.expiresAt < new Date()) throw Errors.validation(null, 'This reset link is invalid or has expired');
    const passwordHash = await hashPassword(newPassword);
    await prisma.$transaction(async (tx) => {
      await tx.passwordResetToken.update({ where: { id: row.id }, data: { consumedAt: new Date() } });
      await tx.user.update({ where: { id: row.userId }, data: { passwordHash, failedLogins: 0, lockedUntil: null } });
      await repo.revokeAllForUser(row.userId, tx);
      await recordAudit({ action: 'auth.password.reset', entityType: 'user', entityId: row.userId, actorId: row.userId }, tx);
    });
    await revokeAccessTokens(row.userId);
  },

  async changePassword(userId: string, currentPassword: string, newPassword: string, meta: ClientMeta): Promise<AuthResponse> {
    const user = await repo.findUserById(userId);
    if (!user) throw Errors.unauthenticated();
    if (!user.passwordHash || !(await verifyPassword(user.passwordHash, currentPassword))) {
      await recordAudit({ action: 'auth.password.change', entityType: 'user', entityId: userId, outcome: 'FAILURE', metadata: { reason: 'bad_current_password' } });
      throw Errors.validation([{ path: 'currentPassword', message: 'Current password is incorrect' }]);
    }
    const passwordHash = await hashPassword(newPassword);
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { passwordHash } });
      await repo.revokeAllForUser(userId, tx);
      await recordAudit({ action: 'auth.password.change', entityType: 'user', entityId: userId }, tx);
    });
    // Order matters: revoke old access tokens first, then mint the new session, whose token is issued
    // after the cut-off and therefore stays valid.
    await revokeAccessTokens(userId);
    const session = await issueSession(user, meta);
    return session.response; // all other devices are signed out; this one continues
  },

  async google(idToken: string, role: 'GUEST' | 'OWNER', meta: ClientMeta, verify: GoogleVerifier = verifyGoogleIdToken): Promise<AuthResponse> {
    const g = await verify(idToken);
    if (!g.emailVerified) throw Errors.validation(null, 'Your Google email address is not verified');

    let user = await repo.findUserByGoogleSub(g.sub);
    let event: 'auth.google.login' | 'auth.google.link' | 'auth.google.register' = 'auth.google.login';
    if (!user) {
      const existing = await repo.findUserByEmail(g.email);
      if (existing) {
        // Google verified ownership of this email, so it is safe to link to the existing account.
        await prisma.user.update({ where: { id: existing.id }, data: { googleSub: g.sub, emailVerifiedAt: existing.emailVerifiedAt ?? new Date(), status: existing.status === 'PENDING_VERIFICATION' ? 'ACTIVE' : existing.status } });
        user = (await repo.findUserById(existing.id))!;
        event = 'auth.google.link';
      } else {
        user = await prisma.$transaction((tx) =>
          repo.createUser(tx, { email: g.email, passwordHash: null, googleSub: g.sub, verified: true, fullName: g.name ?? g.email.split('@')[0]!, avatarUrl: g.picture ?? undefined, roles: role === 'OWNER' ? ['OWNER', 'GUEST'] : ['GUEST'] }),
        );
        event = 'auth.google.register';
      }
    }
    assertUsable(user);
    const session = await prisma.$transaction(async (tx) => {
      await repo.recordSuccessfulLogin(tx, user!.id);
      await recordAudit({ action: event, entityType: 'user', entityId: user!.id, actorId: user!.id, actorRole: user!.roles.map((r) => r.role).join(','), metadata: { method: 'google' } }, tx);
      return issueSession(user!, meta, undefined, tx);
    });
    return session.response;
  },

  async me(userId: string) {
    const user = await repo.findUserById(userId);
    if (!user) throw Errors.unauthenticated();
    assertUsable(user);
    return toUserDto(user);
  },
};

