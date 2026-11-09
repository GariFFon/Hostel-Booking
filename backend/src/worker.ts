// Separate process: runs queued jobs (mail, payment webhooks, refunds) and the recurring sweeps.   pnpm worker
import { Worker, type Queue } from 'bullmq';
import { logger } from '@/core/logger/logger';
import { QUEUE_NAME, closeQueue, createQueueConnection, getQueue, queuePrefix, type JobName } from '@/infra/queue/queue';
import { handlers } from '@/jobs/handlers';

export const SCHEDULES: { name: JobName; everyMs: number }[] = [
  { name: 'expire-holds', everyMs: 30_000 },
  { name: 'retry-refunds', everyMs: 60_000 },
  { name: 'lifecycle-sweep', everyMs: 10 * 60_000 },
  { name: 'reminders', everyMs: 60 * 60_000 },
  { name: 'extend-horizon', everyMs: 24 * 3600_000 },
  { name: 'audit-verify', everyMs: 24 * 3600_000 },
  { name: 'prune-notifications', everyMs: 24 * 3600_000 },
  { name: 'reconcile-ratings', everyMs: 24 * 3600_000 },
];

/** Upsert = idempotent: restarting the worker (or running several) never duplicates a schedule. */
export async function registerSchedules(queue: Queue = getQueue()) {
  for (const s of SCHEDULES) await queue.upsertJobScheduler(`schedule:${s.name}`, { every: s.everyMs }, { name: s.name, data: {} });
}

export function startWorker(opts: { concurrency?: number } = {}) {
  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const handler = handlers[job.name as JobName] as ((d: unknown) => Promise<void>) | undefined;
      if (!handler) throw new Error(`no handler for job "${job.name}"`);
      await handler(job.data);
    },
    { connection: createQueueConnection(), prefix: queuePrefix(), concurrency: opts.concurrency ?? 5 },
  );
  worker.on('failed', (job, err) => logger.error({ job: job?.name, id: job?.id, attempt: job?.attemptsMade, err: err.message }, 'job failed'));
  worker.on('error', (err) => logger.error({ err: err.message }, 'worker error'));
  return worker;
}

async function main() {
  await registerSchedules();
  const worker = startWorker();
  logger.info({ schedules: SCHEDULES.map((s) => s.name) }, 'worker started');

  const stop = async (signal: string) => {
    logger.info({ signal }, 'worker shutting down');
    await worker.close(); // lets in-flight jobs finish
    await closeQueue();
    process.exit(0);
  };
  process.on('SIGTERM', () => void stop('SIGTERM'));
  process.on('SIGINT', () => void stop('SIGINT'));
}

// Run only when executed directly (`pnpm worker`), not when imported by tests.
if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
