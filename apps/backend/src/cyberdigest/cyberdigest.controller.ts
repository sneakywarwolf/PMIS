import { BadRequestException, Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { isValidCveId } from './cve-clients';
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

  private cveView(r: any) {
    return {
      cveId: r.cveId,
      recordStatus: r.recordStatus, // existence/state of the official CVE.org record
      description: r.description, // official text, verbatim
      recordPublishedAt: r.recordPublishedAt,
      recordUpdatedAt: r.recordUpdatedAt,
      // One entry per provider; nothing merged. The label is the provider's, not PMIS's.
      cvss: r.cvss ?? [],
      nvd: { enrichment: r.nvdEnrichment, status: r.nvdStatus, lastModified: r.nvdLastModified },
      // listed: null means the KEV catalog has not been retrieved, so exploitation status from KEV is unknown.
      kev: { listed: r.kevListed, dateAdded: r.kevDateAdded, details: r.kevData },
      affected: r.affected,
      nvdAffected: r.nvdAffected,
      references: r.references,
      conflicts: r.conflicts,
      provenance: r.provenance,
      lastVerifiedAt: r.lastVerifiedAt,
      lastAttemptAt: r.lastAttemptAt,
      lastError: r.lastError,
    };
  }

  @Get('cves')
  @Permission('cyberdigest.view')
  @ApiOperation({ summary: 'CVE records verified against CVE.org / NVD / CISA KEV' })
  async cves(@Query('q') q?: string, @Query('status') status?: string, @Query('kev') kev?: string, @Query('nvd') nvd?: string, @Query('take') take?: string, @Query('skip') skip?: string) {
    const where: any = {};
    if (q) where.OR = [{ cveId: { contains: q.trim().toUpperCase().slice(0, 40) } }, { description: { contains: q.slice(0, 100), mode: 'insensitive' } }];
    if (status && ['PUBLISHED', 'RESERVED', 'REJECTED', 'NOT_FOUND', 'UNAVAILABLE'].includes(status)) where.recordStatus = status;
    if (kev === 'true') where.kevListed = true;
    else if (kev === 'false') where.kevListed = false;
    else if (kev === 'unknown') where.kevListed = null;
    if (nvd && ['PENDING', 'ENRICHED', 'UNAVAILABLE'].includes(nvd)) where.nvdEnrichment = nvd;
    const [total, rows] = await Promise.all([
      this.prisma.digestCve.count({ where }),
      this.prisma.digestCve.findMany({ where, orderBy: [{ kevListed: { sort: 'desc', nulls: 'last' } }, { recordUpdatedAt: { sort: 'desc', nulls: 'last' } }], take: clampInt(take, 25, 1, 100), skip: clampInt(skip, 0, 0, 100000) }),
    ]);
    return { total, items: rows.map((r) => this.cveView(r)) };
  }

  @Get('cves/:id')
  @Permission('cyberdigest.view')
  @ApiOperation({ summary: 'One verified CVE with its change history' })
  async cve(@Param('id') id: string) {
    const cveId = id.trim().toUpperCase();
    if (!isValidCveId(cveId)) throw new BadRequestException('Malformed CVE id');
    const row = await this.prisma.digestCve.findUnique({ where: { cveId } });
    if (!row) throw new NotFoundException('CVE has not been verified yet');
    const history = await this.prisma.digestEvent.findMany({ where: { entityType: 'CVE', entityId: cveId }, orderBy: { createdAt: 'desc' }, take: 50 });
    return { ...this.cveView(row), history };
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
