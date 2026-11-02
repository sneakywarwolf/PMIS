import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { Permission } from '../common/permissions';
import { computeHealth } from './ingestion.service';

const clampInt = (v: string | undefined, def: number, min: number, max: number) => {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};
const parseDate = (v?: string) => {
  const t = v ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? new Date(t) : undefined;
};

@ApiTags('Cyberdigest')
@Controller('cyberdigest')
export class CyberdigestController {
  constructor(private prisma: PrismaService) {}

  @Get('health')
  @Permission('cyberdigest.view')
  @ApiOperation({ summary: 'Per-source ingestion health. Never reports "all healthy" while an enabled source is not.' })
  async health() {
    const [sources, pendingStories] = await Promise.all([
      this.prisma.digestSource.findMany({ orderBy: { name: 'asc' } }),
      this.prisma.digestStory.count({ where: { verificationState: 'PENDING' } }),
    ]);
    const now = new Date();
    const rows = sources.map((s) => ({
      slug: s.slug,
      name: s.name,
      type: s.type,
      website: s.website,
      trustRole: s.trustRole,
      enabled: s.enabled,
      pollIntervalMinutes: s.pollIntervalMinutes,
      health: computeHealth(s, now),
      lastAttemptAt: s.lastAttemptAt,
      lastSuccessAt: s.lastSuccessAt,
      lastError: s.lastError,
      consecutiveFailures: s.consecutiveFailures,
    }));
    const enabled = rows.filter((r) => r.enabled);
    return {
      checkedAt: now,
      // true only when every enabled source succeeded recently; disabled sources are listed as coverage gaps instead.
      allEnabledSourcesHealthy: enabled.length > 0 && enabled.every((r) => r.health === 'HEALTHY'),
      coverageGaps: rows.filter((r) => !r.enabled).map((r) => r.slug),
      pendingStories,
      sources: rows,
    };
  }

  @Get('stories')
  @Permission('cyberdigest.view')
  @ApiOperation({ summary: 'Ingested stories (publisher reporting, not independently verified)' })
  async stories(@Query('q') q?: string, @Query('from') from?: string, @Query('to') to?: string, @Query('source') source?: string, @Query('take') take?: string, @Query('skip') skip?: string) {
    const gte = parseDate(from);
    const lte = parseDate(to);
    const where: any = {};
    if (q) where.OR = [{ title: { contains: q.slice(0, 100), mode: 'insensitive' } }, { cveIds: { has: q.trim().toUpperCase().slice(0, 40) } }];
    if (gte || lte) where.publishedAt = { ...(gte && { gte }), ...(lte && { lte }) };
    if (source) where.source = { slug: source.slice(0, 60) };
    const [total, rows] = await Promise.all([
      this.prisma.digestStory.count({ where }),
      this.prisma.digestStory.findMany({
        where,
        orderBy: [{ publishedAt: { sort: 'desc', nulls: 'last' } }, { ingestedAt: 'desc' }],
        take: clampInt(take, 25, 1, 100),
        skip: clampInt(skip, 0, 0, 100000),
        include: { source: { select: { slug: true, name: true } } },
      }),
    ]);
    return {
      total,
      items: rows.map((r) => ({
        id: r.id,
        title: r.title,
        url: r.canonicalUrl,
        publisher: r.source.name,
        sourceSlug: r.source.slug,
        author: r.author,
        publishedAt: r.publishedAt, // null = the source did not give a date
        ingestedAt: r.ingestedAt,
        summary: r.summary,
        cveIds: r.cveIds, // as mentioned by the publisher; not yet verified
        verificationState: r.verificationState,
        lastVerifiedAt: r.lastVerifiedAt,
      })),
    };
  }
}
