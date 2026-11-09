import { env } from '@/core/config/env';
import type { Mail } from './mailer';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function layout(title: string, body: string, ctaLabel: string, ctaUrl: string): { html: string; text: string } {
  return {
    html: `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:auto;padding:24px">
<h2 style="margin:0 0 12px">${esc(title)}</h2><p style="line-height:1.5">${esc(body)}</p>
<p><a href="${esc(ctaUrl)}" style="display:inline-block;background:#0f766e;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">${esc(ctaLabel)}</a></p>
<p style="color:#666;font-size:12px">If the button doesn't work, paste this link into your browser:<br>${esc(ctaUrl)}</p></div>`,
    text: `${title}\n\n${body}\n\n${ctaLabel}: ${ctaUrl}`,
  };
}

export function verifyEmailMail(to: string, name: string, token: string): Mail {
  const url = `${env().FRONTEND_URL}/verify-email?token=${encodeURIComponent(token)}`;
  return { to, subject: 'Verify your email', ...layout(`Welcome, ${name}!`, 'Confirm your email address to start booking. This link expires in 24 hours.', 'Verify email', url) };
}

export function resetPasswordMail(to: string, token: string): Mail {
  const url = `${env().FRONTEND_URL}/reset-password?token=${encodeURIComponent(token)}`;
  return { to, subject: 'Reset your password', ...layout('Reset your password', 'We received a request to reset your password. This link expires in 1 hour. If this wasn\'t you, ignore this email.', 'Choose a new password', url) };
}
