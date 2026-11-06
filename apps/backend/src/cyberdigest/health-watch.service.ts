import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { JobRunner } from './job-runner';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { computeHealth } from './ingestion.service';

const REALERT_AFTER_MS = 24 * 3600_000;
const FAILING_STREAK = 3;

/**
 * Tells the people who manage Cyberdigest sources when a source stops working. One notification per outage (repeated
 * daily while it lasts) and one when it recovers. FAILING needs 3 failed attempts in a row and STALE needs 3 missed
 * intervals, so a single blip does not page anyone.
 */
@Injectable()
export class HealthWatchService {
  private readonly log = new Logger(HealthWatchService.name);
  private running = false;

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
    @Optional() private runner?: JobRunner,
  ) {}

  /** Operational alerts go to Administrators only: they are the only role that can act on them. */
  private async managers(): Promise<string[]> {
    const users = await this.prisma.user.findMany({ where: { isActive: true, role: 'ADMIN' }, select: { id: true } });
    return users.map((u) => u.id);
  }

  private async tell(title: string, message: string, relatedId: string) {
    for (const userId of await this.managers()) {
      try {
        await this.notifications.create({ userId, type: 'CYBERDIGEST_SOURCE_DOWN', title, message: message.slice(0, 300), linkUrl: '/dashboard/cyberdigest', relatedId });
      } catch (e) {
        this.log.warn(`Could not send a source alert: ${(e as Error).message}`);
      }
    }
  }

  /** Returns the alerts raised (for tests and logs). */
  async check(now = new Date()): Promise<string[]> {
    const raised: string[] = [];
    const sources = await this.prisma.digestSource.findMany({ where: { enabled: true } });
    for (const s of sources) {
      let h = computeHealth(s, now);
      // The dashboard may call a never-succeeded source "failing" after one miss; paging someone needs a real streak.
      if (h === 'FAILING' && s.consecutiveFailures < FAILING_STREAK) h = 'UNKNOWN';
      const last = await this.prisma.digestEvent.findFirst({ where: { entityType: 'SOURCE', entityId: s.slug, event: { in: ['ALERT', 'RECOVERED'] } }, orderBy: { createdAt: 'desc' } });
      if (h === 'FAILING' || h === 'STALE') {
        const due = !last || last.event === 'RECOVERED' || now.getTime() - last.createdAt.getTime() > REALERT_AFTER_MS;
        if (!due) continue;
        await this.prisma.digestEvent.create({ data: { entityType: 'SOURCE', entityId: s.slug, event: 'ALERT', detail: { health: h, error: s.lastError ?? null } } });
        await this.tell(`${s.name} is ${h.toLowerCase()}`, `${s.name} has ${h === 'FAILING' ? `failed ${s.consecutiveFailures} times in a row` : 'not been checked successfully for several intervals'}${s.lastError ? ` (${s.lastError})` : ''}. Digest content from it may be missing or out of date.`, s.id);
        raised.push(`${s.slug}:${h}`);
      } else if (h === 'HEALTHY' && last?.event === 'ALERT') {
        await this.prisma.digestEvent.create({ data: { entityType: 'SOURCE', entityId: s.slug, event: 'RECOVERED', detail: {} } });
        await this.tell(`${s.name} has recovered`, `${s.name} is being checked successfully again.`, s.id);
        raised.push(`${s.slug}:RECOVERED`);
      }
    }
    // A background job that keeps failing is as serious as a source that is down: nothing new would be published.
    if (this.runner) {
      for (const j of (await this.runner.status()) as { job: string; failureStreak: number; lastError: string | null }[]) {
        const last = await this.prisma.digestEvent.findFirst({ where: { entityType: 'JOB', entityId: j.job, event: { in: ['ALERT', 'RECOVERED'] } }, orderBy: { createdAt: 'desc' } });
        if (j.failureStreak >= FAILING_STREAK) {
          if (last && last.event === 'ALERT' && now.getTime() - last.createdAt.getTime() <= REALERT_AFTER_MS) continue;
          await this.prisma.digestEvent.create({ data: { entityType: 'JOB', entityId: j.job, event: 'ALERT', detail: { streak: j.failureStreak, error: j.lastError } } });
          await this.tell(`Cyberdigest job "${j.job}" is failing`, `The "${j.job}" job has failed ${j.failureStreak} times in a row${j.lastError ? ` (${j.lastError})` : ''}. It retries automatically with increasing delays.`, `job:${j.job}`);
          raised.push(`job:${j.job}:FAILING`);
        } else if (last?.event === 'ALERT') {
          await this.prisma.digestEvent.create({ data: { entityType: 'JOB', entityId: j.job, event: 'RECOVERED', detail: {} } });
          await this.tell(`Cyberdigest job "${j.job}" has recovered`, `The "${j.job}" job is running successfully again.`, `job:${j.job}`);
          raised.push(`job:${j.job}:RECOVERED`);
        }
      }
    }
    return raised;
  }

  @Cron('*/10 * * * *')
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      if (this.runner) await this.runner.run('health-watch', async () => ({ alerts: (await this.check()).length }));
      else await this.check();
    } catch (e) {
      this.log.error(`Source health check failed: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
