import { z } from 'zod';

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_ENV: z.enum(['local', 'test', 'staging', 'production']).default('local'),
  APP_URL: z.url(),
  FRONTEND_URL: z.url().default('http://localhost:3000'),
  CORS_ALLOWED_ORIGINS: z
    .string()
    .default('')
    .transform((s) => s.split(',').map((o) => o.trim()).filter(Boolean)),

  DATABASE_URL: z.string().startsWith('postgresql://'),
  REDIS_URL: z.string().startsWith('redis'),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 chars'),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  GOOGLE_CLIENT_IDS: z
    .string()
    .default('')
    .transform((s) => s.split(',').map((o) => o.trim()).filter(Boolean)),

  CLOUDINARY_CLOUD_NAME: z.string().default(''),
  CLOUDINARY_API_KEY: z.string().default(''),
  CLOUDINARY_API_SECRET: z.string().default(''),
  CLOUDINARY_FOLDER_PREFIX: z.string().default('hostel-booking'),

  MAIL_DRIVER: z.enum(['smtp', 'resend', 'log']).default('smtp'),
  MAIL_FROM: z.string().default('Hostel Booking <no-reply@hostel.local>'),
  SMTP_HOST: z.string().default('127.0.0.1'),
  SMTP_PORT: z.coerce.number().int().default(1025),
  RESEND_API_KEY: z.string().default(''),

  PAYMENT_PROVIDER: z.enum(['demo']).default('demo'),
  DEMO_WEBHOOK_SECRET: z.string().min(16),
  /** The demo gateway lets guests "pay" without money. Blocked in production unless this is set on purpose. */
  ALLOW_DEMO_PAYMENTS: bool.default(false),
  DEMO_WEBHOOK_DELAY_MS: z.coerce.number().int().min(0).default(1500),

  // India GST on accommodation (per room-night declared tariff). Confirm current slabs with your accountant.
  GST_LOW_BPS: z.coerce.number().int().min(0).max(5000).default(500),
  GST_HIGH_BPS: z.coerce.number().int().min(0).max(5000).default(1800),
  GST_THRESHOLD_PAISE: z.coerce.number().int().min(0).default(750000),

  GEOCODER_BASE_URL: z.url().default('https://nominatim.openstreetmap.org'),
  GEOCODER_USER_AGENT: z.string().default('HostelBookingApp/1.0'),
  GEOCODER_COUNTRY_CODES: z.string().default('in'),

  PLATFORM_COMMISSION_BPS: z.coerce.number().int().min(0).max(5000).default(1000),
  // Request-to-book: how long an owner has to answer, and how long the guest then has to pay.
  APPROVAL_WINDOW_HOURS: z.coerce.number().int().min(1).max(168).default(24),
  APPROVAL_PAYMENT_WINDOW_MINUTES: z.coerce.number().int().min(5).max(1440).default(180),
  MAX_OPEN_BOOKINGS_PER_USER: z.coerce.number().int().min(1).max(20).default(3),
  QUEUE_MODE: z.enum(['bullmq', 'inline']).default('bullmq'), // inline = run jobs in-process (tests)
  BOOKING_HOLD_MINUTES: z.coerce.number().int().min(1).max(120).default(15),
  LOG_LEVEL: z.enum(['silent', 'fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  TRUST_PROXY: bool.default(false),
  /** How many reverse proxies sit in front of the API; the client IP is the X-Forwarded-For entry that many places from the right. */
  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(1).max(5).default(1),
});

export type Env = z.infer<typeof schema>;

export function parseEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = schema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  // The template ships obvious placeholders; running staging or production on them would mean a publicly known signing secret.
  const { APP_ENV, JWT_ACCESS_SECRET, DEMO_WEBHOOK_SECRET } = result.data;
  if ((APP_ENV === 'staging' || APP_ENV === 'production') && [JWT_ACCESS_SECRET, DEMO_WEBHOOK_SECRET].some((v) => v.startsWith('change-me'))) {
    throw new Error('Invalid environment configuration:\n  - JWT_ACCESS_SECRET / DEMO_WEBHOOK_SECRET still hold the template placeholder: generate real secrets');
  }
  return result.data;
}

let cached: Env | undefined;
/** Lazily validated singleton so `next build` doesn't need runtime secrets. */
export function env(): Env {
  return (cached ??= parseEnv());
}
