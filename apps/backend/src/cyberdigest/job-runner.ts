import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { DigestConfigService } from './digest-config.service';
import { publicError } from './errors';

export type JobOutcome = 'ran' | 'failed' | 'skipped';

export const JOBS = ['ingestion', 'cve-verification', 'zero-day', 'story-review', 'digest', 'health-watch', 'retention'] as const;

const MAX_BACKOFF_MIN = 60;

/** Minutes to wait after `streak` consecutive failures: base, 2x, 4x ... capped. */
export function backoffMinutes(base: number, streak: number): number {
  return streak <= 0 ? 0 : Math.min(base * 2 ** (streak - 1), MAX_BACKOFF_MIN);
}

/**
 * Wraps every scheduled Cyberdigest job so that, uniformly:
 *  - nothing runs while the administrator has paused the pipeline,
 *  - only one instance runs a given job at a time (a database lease that expires, so a crash cannot wedge it),
 *  - every run is recorded (start, end, outcome, a safe error text) for the administrator's history and monitoring,
 *  - a failing job backs off exponentially instead of hammering a broken dependency, and recovers by itself.
 */
@Injectable()
export class JobRunner {
  private readonly log = new Logger(JobRunner.name);
  private readonly holder = randomUUID();

  constructor(
    private prisma: PrismaService,
    private config: DigestConfigService,
  ) {}

  private async acquire(job: string, leaseMs: number, now: Date): Promise<boolean> {
    const expiresAt = new Date(now.getTime() + leaseMs);
    const taken = await this.prisma.digestLock.updateMany({ where: { name: job, OR: [{ expiresAt: { lt: now } }, { holder: this.holder }] }, data: { holder: this.holder, expiresAt } });
    if (taken.count > 0) return true;
    try {
      await this.prisma.digestLock.create({ data: { name: job, holder: this.holder, expiresAt } });
      return true;
    } catch (e: any) {
      if (e?.code === 'P2002') return false; // another worker holds a live lease
      throw e;
    }
  }

  async failureStreak(job: string): Promise<{ streak: number; lastFinishedAt: Date | null }> {
    const recent = await this.prisma.digestJobRun.findMany({ where: { job, status: { in: ['OK', 'FAILED'] } }, orderBy: { startedAt: 'desc' }, take: 10 });
    let streak = 0;
    for (const r of recent) {
      if (r.status !== 'FAILED') break;
      streak++;
    }
    return { streak, lastFinishedAt: recent[0]?.finishedAt ?? null };
  }

  /**
   * Runs `fn` as the named job. Never throws: scheduler ticks must not crash the process.
   * `requirePipeline: false` is for housekeeping that should work even while processing is paused.
   */
  async run<T>(job: string, fn: () => Promise<T>, opts: { leaseMs?: number; requirePipeline?: boolean; now?: Date } = {}): Promise<JobOutcome> {
    const now = opts.now ?? new Date();
    const leaseMs = opts.leaseMs ?? 15 * 60_000;
    try {
      const cfg = await this.config.get();
      if (opts.requirePipeline !== false && !cfg.pipelineEnabled) return 'skipped';

      const { streak, lastFinishedAt } = await this.failureStreak(job);
      if (streak > 0 && lastFinishedAt && now.getTime() < lastFinishedAt.getTime() + backoffMinutes(cfg.jobRetryBackoffMinutes, streak) * 60_000) return 'skipped';

      if (!(await this.acquire(job, leaseMs, now))) return 'skipped';
      // A run left RUNNING by a crashed worker is closed out, so the history never shows a job running for days.
      await this.prisma.digestJobRun.updateMany({ where: { job, status: 'RUNNING', startedAt: { lt: new Date(now.getTime() - leaseMs) } }, data: { status: 'FAILED', finishedAt: now, error: 'worker stopped before finishing' } });
      const run = await this.prisma.digestJobRun.create({ data: { job, status: 'RUNNING', startedAt: now } });
      try {
        const result = await fn();
        await this.prisma.digestJobRun.update({ where: { id: run.id }, data: { status: 'OK', finishedAt: opts.now ?? new Date(), detail: typeof result === 'object' && result !== null ? (result as any) : undefined } });
        return 'ran';
      } catch (e) {
        this.log.error(`Cyberdigest job "${job}" failed: ${(e as Error).message}`);
        await this.prisma.digestJobRun.update({ where: { id: run.id }, data: { status: 'FAILED', finishedAt: opts.now ?? new Date(), error: publicError(e) } });
        return 'failed';
      } finally {
        await this.prisma.digestLock.deleteMany({ where: { name: job, holder: this.holder } });
      }
    } catch (e) {
      // The database itself is unreachable: nothing can be recorded. The next tick tries again.
      this.log.error(`Cyberdigest job "${job}" could not start: ${(e as Error).message}`);
      return 'failed';
    }
  }

  /** Per job: when it last worked, when it last ran, and whether it is currently failing. For the administrator's monitoring screen. */
  async status() {
    const out: Record<string, unknown>[] = [];
    const since = new Date(Date.now() - 24 * 3600_000);
    for (const job of JOBS) {
      const [lastOk, last, failed24h, { streak }] = await Promise.all([
        this.prisma.digestJobRun.findFirst({ where: { job, status: 'OK' }, orderBy: { startedAt: 'desc' } }),
        this.prisma.digestJobRun.findFirst({ where: { job }, orderBy: { startedAt: 'desc' } }),
        this.prisma.digestJobRun.count({ where: { job, status: 'FAILED', startedAt: { gte: since } } }),
        this.failureStreak(job),
      ]);
      out.push({ job, lastSuccessAt: lastOk?.finishedAt ?? null, lastRunAt: last?.startedAt ?? null, lastStatus: last?.status ?? null, lastError: last?.status === 'FAILED' ? last.error : null, failureStreak: streak, failedLast24h: failed24h });
    }
    return out;
  }

  history(job: string | undefined, take = 50) {
    return this.prisma.digestJobRun.findMany({ where: job && (JOBS as readonly string[]).includes(job) ? { job } : {}, orderBy: { startedAt: 'desc' }, take: Math.min(Math.max(take, 1), 200) });
  }
}
