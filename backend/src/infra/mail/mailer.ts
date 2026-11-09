import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '@/core/config/env';
import { logger } from '@/core/logger/logger';

export interface Mail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/** In-memory outbox used by the `log` driver (tests and quiet local dev). */
export const outbox: Mail[] = [];

let transport: Transporter | undefined;

/**
 * Sends mail without ever throwing into a request: a mail outage must not fail registration or booking.
 * (Phase 5 moves this onto the BullMQ mail queue for retries.)
 */
export async function sendMail(mail: Mail): Promise<boolean> {
  const e = env();
  try {
    if (e.MAIL_DRIVER === 'log') {
      outbox.push(mail);
      logger.info({ to: mail.to, subject: mail.subject }, 'mail (log driver)');
      return true;
    }
    if (e.MAIL_DRIVER === 'resend') {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${e.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: e.MAIL_FROM, to: mail.to, subject: mail.subject, html: mail.html, text: mail.text }),
      });
      if (!res.ok) throw new Error(`resend ${res.status}`);
      return true;
    }
    transport ??= nodemailer.createTransport({ host: e.SMTP_HOST, port: e.SMTP_PORT, secure: false, ignoreTLS: true });
    await transport.sendMail({ from: e.MAIL_FROM, to: mail.to, subject: mail.subject, html: mail.html, text: mail.text });
    return true;
  } catch (err) {
    logger.error({ err: (err as Error).message, to: mail.to, subject: mail.subject }, 'mail send failed');
    return false;
  }
}
