import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/infra/db/prisma';
import { redis } from '@/infra/redis/redis';
import { outbox } from '@/infra/mail/mailer';
import { authService } from '@/modules/auth/auth.service';
import { requireRole } from '@/core/auth/rbac';
import { proxy } from '@/proxy';
import { NextRequest } from 'next/server';
import { POST as register } from '@/app/api/v1/auth/register/route';
import { POST as login } from '@/app/api/v1/auth/login/route';
import { POST as refresh } from '@/app/api/v1/auth/refresh/route';
import { POST as logout } from '@/app/api/v1/auth/logout/route';
import { POST as verifyEmail } from '@/app/api/v1/auth/verify-email/route';
import { POST as forgot } from '@/app/api/v1/auth/forgot-password/route';
import { POST as reset } from '@/app/api/v1/auth/reset-password/route';
import { POST as google } from '@/app/api/v1/auth/google/route';
import { GET as me, PATCH as patchMe } from '@/app/api/v1/me/route';
import { POST as changePassword } from '@/app/api/v1/me/password/route';
import { POST as becomeOwner } from '@/app/api/v1/me/become-owner/route';
import { call, freshIp } from '../helpers/http';

const PASSWORD = 'Sup3rSecret!';
let n = 0;
const newEmail = () => `user${++n}-${Date.now()}@test.dev`;
const meta = { ip: '127.0.0.1', userAgent: 'vitest' };
const lastMailTo = (to: string) => [...outbox].reverse().find((m) => m.to === to)!;
const tokenFrom = (mail: { text: string }) => new URL(mail.text.match(/https?:\/\/\S+/)![0]).searchParams.get('token')!;

async function signUp(overrides: Record<string, unknown> = {}) {
  const email = newEmail();
  const res = await call(register, { body: { email, password: PASSWORD, fullName: 'Test User', ...overrides } });
  return { email, res, auth: res.body.data };
}

beforeAll(async () => {
  await redis.flushdb();
});

describe('register', () => {
  it('creates a guest, returns tokens, sends a verification mail, audits it, leaks no secrets', async () => {
    const { email, res } = await signUp();
    expect(res.status).toBe(201);
    expect(res.body.data.user).toMatchObject({ email, roles: ['GUEST'], emailVerified: false, hasPassword: true });
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|\$argon2/);
    expect(lastMailTo(email).subject).toMatch(/verify/i);
    const audit = await prisma.auditLog.findFirst({ where: { action: 'auth.register', entityId: res.body.data.user.id } });
    expect(audit?.after).toMatchObject({ email });
    expect(JSON.stringify(audit?.after)).not.toMatch(/argon2/);
  });

  it('rejects duplicate emails, weak passwords and bad bodies with the standard envelope', async () => {
    const { email } = await signUp();
    const dup = await call(register, { body: { email: email.toUpperCase(), password: PASSWORD, fullName: 'Dup' } });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('CONFLICT');

    const weak = await call(register, { body: { email: newEmail(), password: 'short', fullName: 'Weak' } });
    expect(weak.status).toBe(422);
    expect(weak.body.error.details[0].path).toBe('password');
    expect(weak.body.error.requestId).toBeTruthy();

    const admin = await call(register, { body: { email: newEmail(), password: PASSWORD, fullName: 'Sneaky', role: 'ADMIN' } });
    expect(admin.status).toBe(422); // ADMIN is never self-assignable
  });

  it('rate-limits registrations per IP', async () => {
    const ip = freshIp();
    for (let i = 0; i < 10; i++) {
      const r = await call(register, { ip, body: { email: newEmail(), password: PASSWORD, fullName: 'Burst' } });
      expect(r.status).toBe(201);
    }
    const blocked = await call(register, { ip, body: { email: newEmail(), password: PASSWORD, fullName: 'Burst' } });
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
  });
});

describe('login & lockout', () => {
  it('logs in, and gives identical errors for unknown email vs wrong password', async () => {
    const { email } = await signUp();
    const ok = await call(login, { body: { email, password: PASSWORD } });
    expect(ok.status).toBe(200);
    const wrong = await call(login, { body: { email, password: 'Wrong-pass-1' } });
    const unknown = await call(login, { body: { email: newEmail(), password: 'Wrong-pass-1' } });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error.message).toBe(unknown.body.error.message);
  });

  it('locks the account after 5 bad passwords, even for the right one, and audits failures', async () => {
    const { email, auth } = await signUp();
    for (let i = 0; i < 5; i++) {
      const r = await call(login, { body: { email, password: 'Wrong-pass-1' } });
      expect(r.status).toBe(401);
    }
    const locked = await call(login, { body: { email, password: PASSWORD } });
    expect(locked.status).toBe(429);
    const failures = await prisma.auditLog.count({ where: { action: 'auth.login', outcome: { in: ['FAILURE', 'DENIED'] }, entityId: auth.user.id } });
    expect(failures).toBe(6);
  });
});

describe('access tokens & /me', () => {
  it('requires a valid bearer token', async () => {
    const { auth } = await signUp();
    expect((await call(me, { method: 'GET' })).status).toBe(401);
    expect((await call(me, { method: 'GET', token: auth.accessToken + 'x' })).status).toBe(401);
    const good = await call(me, { method: 'GET', token: auth.accessToken });
    expect(good.status).toBe(200);
    expect(good.body.data.id).toBe(auth.user.id);
  });

  it('updates the profile, audits before/after, and rejects unknown fields', async () => {
    const { auth } = await signUp();
    const res = await call(patchMe, { method: 'PATCH', token: auth.accessToken, body: { fullName: 'New Name', city: 'Pune' } });
    expect(res.body.data.fullName).toBe('New Name');
    const audit = await prisma.auditLog.findFirst({ where: { action: 'user.profile.update', entityId: auth.user.id } });
    expect(audit?.before).toMatchObject({ fullName: 'Test User' });
    expect(audit?.after).toMatchObject({ fullName: 'New Name', city: 'Pune' });
    expect((await call(patchMe, { method: 'PATCH', token: auth.accessToken, body: { roles: ['ADMIN'] } })).status).toBe(422);
  });
});

describe('refresh rotation', () => {
  it('rotates tokens and revokes the whole family when an old token is replayed', async () => {
    const { auth } = await signUp();
    const r1 = await call(refresh, { body: { refreshToken: auth.refreshToken } });
    expect(r1.status).toBe(200);
    expect(r1.body.data.refreshToken).not.toBe(auth.refreshToken);

    const replay = await call(refresh, { body: { refreshToken: auth.refreshToken } });
    expect(replay.status).toBe(401);
    // the legitimately rotated token is now dead too
    const afterReplay = await call(refresh, { body: { refreshToken: r1.body.data.refreshToken } });
    expect(afterReplay.status).toBe(401);
    expect(await prisma.auditLog.count({ where: { action: 'auth.refresh.reuse_detected', entityId: auth.user.id } })).toBeGreaterThanOrEqual(1);
  });

  it('only lets one of many concurrent refreshes with the same token win', async () => {
    const { auth } = await signUp();
    const results = await Promise.all(Array.from({ length: 6 }, () => call(refresh, { body: { refreshToken: auth.refreshToken } })));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
  });

  it('logout revokes the session', async () => {
    const { auth } = await signUp();
    expect((await call(logout, { body: { refreshToken: auth.refreshToken } })).status).toBe(200);
    expect((await call(refresh, { body: { refreshToken: auth.refreshToken } })).status).toBe(401);
    expect((await call(logout, { body: { refreshToken: auth.refreshToken } })).status).toBe(200); // idempotent
  });
});

describe('email verification', () => {
  it('verifies once, and the next token carries emailVerified', async () => {
    const { email, auth } = await signUp();
    const token = tokenFrom(lastMailTo(email));
    expect((await call(verifyEmail, { body: { token } })).status).toBe(200);
    expect((await call(verifyEmail, { body: { token } })).status).toBe(422); // single use
    const fresh = await call(refresh, { body: { refreshToken: auth.refreshToken } });
    expect(fresh.body.data.user.emailVerified).toBe(true);
  });
});

describe('password reset & change', () => {
  it('does not reveal whether an email exists', async () => {
    const before = outbox.length;
    const res = await call(forgot, { body: { email: newEmail() } });
    expect(res.status).toBe(200);
    expect(outbox.length).toBe(before);
  });

  it('reset sets a new password, kills old sessions and access tokens, and the link is single-use', async () => {
    const { email, auth } = await signUp();
    await call(forgot, { body: { email } });
    const token = tokenFrom(lastMailTo(email));
    expect((await call(reset, { body: { token, password: 'Brand-new-pass9' } })).status).toBe(200);
    expect((await call(reset, { body: { token, password: 'Another-pass-9' } })).status).toBe(422);

    expect((await call(refresh, { body: { refreshToken: auth.refreshToken } })).status).toBe(401);
    expect((await call(me, { method: 'GET', token: auth.accessToken })).status).toBe(401);
    expect((await call(login, { body: { email, password: PASSWORD } })).status).toBe(401);
    const fresh = await call(login, { body: { email, password: 'Brand-new-pass9' } });
    expect(fresh.status).toBe(200);
    expect((await call(me, { method: 'GET', token: fresh.body.data.accessToken })).status).toBe(200);
  });

  it('change-password requires the current password and returns a fresh session', async () => {
    const { auth } = await signUp();
    const bad = await call(changePassword, { token: auth.accessToken, body: { currentPassword: 'nope-nope-1', newPassword: 'Another-pass-9' } });
    expect(bad.status).toBe(422);
    const ok = await call(changePassword, { token: auth.accessToken, body: { currentPassword: PASSWORD, newPassword: 'Another-pass-9' } });
    expect(ok.status).toBe(200);
    expect((await call(refresh, { body: { refreshToken: auth.refreshToken } })).status).toBe(401);
    expect((await call(me, { method: 'GET', token: ok.body.data.accessToken })).status).toBe(200);
  });
});

describe('google sign-in', () => {
  const identity = (email: string, over: Record<string, unknown> = {}) => async () => ({ sub: `g-${email}`, email, emailVerified: true, name: 'Gina Google', picture: null, ...over });

  it('registers a new verified user without a password', async () => {
    const email = newEmail();
    const out = await authService.google('x'.repeat(30), 'GUEST', meta, identity(email));
    expect(out.user).toMatchObject({ email, emailVerified: true, hasPassword: false, googleLinked: true });
  });

  it('links to an existing password account and is idempotent on later logins', async () => {
    const { email, auth } = await signUp();
    const linked = await authService.google('x'.repeat(30), 'GUEST', meta, identity(email));
    expect(linked.user.id).toBe(auth.user.id);
    expect(linked.user).toMatchObject({ googleLinked: true, emailVerified: true, hasPassword: true });
    const again = await authService.google('x'.repeat(30), 'GUEST', meta, identity(email));
    expect(again.user.id).toBe(auth.user.id);
  });

  it('refuses unverified Google emails, and reports misconfiguration clearly', async () => {
    await expect(authService.google('x'.repeat(30), 'GUEST', meta, identity(newEmail(), { emailVerified: false }))).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    const res = await call(google, { body: { idToken: 'y'.repeat(40) } });
    expect(res.status).toBe(503); // GOOGLE_CLIENT_IDS is empty in tests
  });
});

describe('roles', () => {
  it('guests cannot reach admin-only logic; becoming an owner adds the role after a refresh', async () => {
    const { auth } = await signUp();
    expect(() => requireRole({ id: auth.user.id, roles: ['GUEST'], emailVerified: true }, 'ADMIN')).toThrow(/permission/);
    const owner = await call(becomeOwner, { token: auth.accessToken });
    expect(owner.body.data.roles.sort()).toEqual(['GUEST', 'OWNER']);
    expect(await prisma.ownerProfile.findUnique({ where: { userId: auth.user.id } })).toMatchObject({ kycStatus: 'NOT_SUBMITTED' });
    expect((await call(becomeOwner, { token: auth.accessToken })).status).toBe(401); // old token revoked, must refresh
    const fresh = await call(refresh, { body: { refreshToken: auth.refreshToken } });
    expect((await call(becomeOwner, { token: fresh.body.data.accessToken })).status).toBe(409);
  });
});

describe('CORS proxy', () => {
  const req = (method: string, origin: string) => new NextRequest('http://localhost:4000/api/v1/hostels', { method, headers: { origin } });
  it('answers preflight for allowed origins only', () => {
    const okRes = proxy(req('OPTIONS', 'http://localhost:3000'));
    expect(okRes.status).toBe(204);
    expect(okRes.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
    const bad = proxy(req('OPTIONS', 'https://evil.example'));
    expect(bad.status).toBe(403);
    expect(bad.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('audit integrity after all auth activity', () => {
  it('hash chain is intact', async () => {
    const broken = await prisma.$queryRaw<unknown[]>`SELECT * FROM audit_verify_chain(0)`;
    expect(broken).toHaveLength(0);
  });
});
