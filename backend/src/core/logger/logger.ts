import pino from 'pino';

// Secrets must never reach logs; redaction is applied at the logger level.
export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      '*.password',
      '*.passwordHash',
      '*.refreshToken',
      '*.accessToken',
      '*.idToken',
      '*.token',
      '*.apiSecret',
    ],
    censor: '[REDACTED]',
  },
  base: { service: 'hostel-backend' },
  timestamp: pino.stdTimeFunctions.isoTime,
});
