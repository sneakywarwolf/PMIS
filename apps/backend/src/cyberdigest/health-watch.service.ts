import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { permissionRules } from '../common/permissions';
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
  ) {}

  private async managers(): Promise<string[]> {
    const users = await this.prisma.user.findMany({ where: { isActive: true }, select: { id: true, role: true } });
    return users.filter((u) => permissionRules.can(u.role, 'cyberdigest.manage_sources')).map((u) => u.id);
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
    return raised;
  }

  @Cron('*/10 * * * *')
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.check();
    } catch (e) {
      this.log.error(`Source health check failed: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
