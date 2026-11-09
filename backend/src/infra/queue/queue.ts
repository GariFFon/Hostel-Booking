import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { env } from '@/core/config/env';
import { logger } from '@/core/logger/logger';
import type { Mail } from '@/infra/mail/mailer';

/** Everything that runs outside a request. Payloads are plain JSON so they survive Redis and retries. */
export interface JobMap {
  mail: Mail;
  'demo-webhook': { paymentId: string; attemptId: string; instrument: string; stage: 'primary' | 'settle' };
  'process-refund': { refundId: string };
  'expire-holds': Record<string, never>;
  'lifecycle-sweep': Record<string, never>;
  'retry-refunds': Record<string, never>;
  reminders: Record<string, never>;
  'extend-horizon': Record<string, never>;
  'audit-verify': Record<string, never>;
  'prune-notifications': Record<string, never>;
  'reconcile-ratings': Record<string, never>;
}
export type JobName = keyof JobMap;

export interface EnqueueOptions {
  delayMs?: number;
  /** De-duplicates: a job with this id that is already queued is not added again. */
  jobId?: string;
}

type Mode = 'bullmq' | 'inline' | 'capture';
let override: Mode | null = null;
const mode = (): Mode => override ?? env().QUEUE_MODE;
/** Current execution mode (the demo gateway delivers over HTTP only when a real worker is in play). */
export const queueMode = mode;

/** Test seam. `capture` collects jobs so a test can run them (or not) in any order. */
export function setQueueMode(m: Mode | null) {
  override = m;
}

export interface CapturedJob { name: JobName; data: unknown; opts: EnqueueOptions }
export const captured: CapturedJob[] = [];

export const QUEUE_NAME = 'jobs';
export const queuePrefix = () => `hb:${env().APP_ENV}:bull`;

/** BullMQ needs `maxRetriesPerRequest: null`, so it gets its own connection. */
export function createQueueConnection() {
  return new Redis(env().REDIS_URL, { maxRetriesPerRequest: null });
}

let queue: Queue | undefined;
export function getQueue(): Queue {
  queue ??= new Queue(QUEUE_NAME, {
    connection: createQueueConnection(),
    prefix: queuePrefix(),
    defaultJobOptions: { attempts: 6, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: 500, removeOnFail: 5000 },
  });
  return queue;
}

export async function closeQueue() {
  await queue?.close();
  queue = undefined;
}

export async function runHandler<N extends JobName>(name: N, data: JobMap[N]) {
  const { handlers } = await import('@/jobs/handlers'); // lazy: handlers import services that import this module
  await handlers[name](data);
}

/** Runs captured jobs in order (new jobs enqueued meanwhile run too). Returns how many ran. */
export async function runCaptured(filter?: (j: CapturedJob) => boolean): Promise<number> {
  let ran = 0;
  for (let i = 0; i < captured.length; ) {
    const job = captured[i]!;
    if (filter && !filter(job)) { i++; continue; }
    captured.splice(i, 1);
    await runHandler(job.name, job.data as never);
    ran++;
  }
  return ran;
}

export async function enqueue<N extends JobName>(name: N, data: JobMap[N], opts: EnqueueOptions = {}): Promise<void> {
  const m = mode();
  if (m === 'capture') {
    captured.push({ name, data, opts });
    return;
  }
  if (m === 'inline') {
    try {
      await runHandler(name, data);
    } catch (e) {
      logger.error({ err: (e as Error).message, job: name }, 'inline job failed');
    }
    return;
  }
  try {
    await getQueue().add(name, data, { delay: opts.delayMs, jobId: opts.jobId });
  } catch (e) {
    // Redis down: do the work now rather than lose it (mail and refunds are idempotent).
    logger.warn({ err: (e as Error).message, job: name }, 'could not enqueue; running inline');
    try { await runHandler(name, data); } catch (err) { logger.error({ err: (err as Error).message, job: name }, 'fallback job failed'); }
  }
}
