import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { Prisma, User } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { CATEGORIES } from './classify';
import { StoryReviewService } from './story-review.service';
import { Request } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { isValidCveId } from './cve-clients';
import { Actor, EvidenceInput, ZeroDayService } from './zero-day.service';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { Permission } from '../common/permissions';
import { computeHealth, IngestionService } from './ingestion.service';

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
  constructor(
    private prisma: PrismaService,
    private zeroDay: ZeroDayService,
    private storyReview: StoryReviewService,
    private ingestion: IngestionService,
    private audit: AuditService,
  ) {}

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
      vendors: r.vendors ?? [],
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
  async cves(@Query('q') q?: string, @Query('status') status?: string, @Query('kev') kev?: string, @Query('nvd') nvd?: string, @Query('severity') severity?: string, @Query('vendor') vendor?: string, @Query('take') take?: string, @Query('skip') skip?: string) {
    const where: any = {};
    // Severity is the label a provider attached to its own score; PMIS does not calculate one. Patch status is not filterable: it is not collected yet.
    if (severity && ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].includes(severity.toUpperCase())) where.maxCvssSeverity = severity.toUpperCase();
    if (vendor && vendor.trim()) where.vendors = { has: vendor.trim().toLowerCase().slice(0, 80) };
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

  private actor(user: User, req: Request): Actor {
    return { id: user.id, ip: req.ip ?? '', userAgent: String(req.headers['user-agent'] ?? '') };
  }

  @Get('zero-days')
  @Permission('cyberdigest.view')
  @ApiOperation({ summary: 'Zero-day cases by section: confirmed (analyst-approved only), known_exploited, review' })
  async zeroDays(@Query('section') section?: string) {
    const s = section === 'confirmed' || section === 'known_exploited' ? section : 'review';
    return { section: s, items: await this.zeroDay.list(s) };
  }

  @Get('zero-days/:id')
  @Permission('cyberdigest.view')
  async zeroDay1(@Param('id') id: string) {
    const cveId = id.trim().toUpperCase();
    if (!isValidCveId(cveId)) throw new BadRequestException('Malformed CVE id');
    return this.zeroDay.view(cveId);
  }

  @Post('zero-days/:id/evidence')
  @Permission('cyberdigest.review')
  @ApiOperation({ summary: 'Record evidence for a zero-day case (analyst)' })
  async addEvidence(@Param('id') id: string, @Body() body: EvidenceInput, @CurrentUser() user: User, @Req() req: Request) {
    await this.zeroDay.addEvidence(id, body, this.actor(user, req));
    return this.zeroDay.view(id.trim().toUpperCase());
  }

  @Post('zero-days/evidence/:evidenceId/retract')
  @Permission('cyberdigest.review')
  async retract(@Param('evidenceId') evidenceId: string, @Body() body: { reason?: string }, @CurrentUser() user: User, @Req() req: Request) {
    await this.zeroDay.retractEvidence(evidenceId, body?.reason, this.actor(user, req));
    return { ok: true };
  }

  @Post('zero-days/:id/transition')
  @Permission('cyberdigest.review')
  async transition(@Param('id') id: string, @Body() body: { state?: string; reason?: string }, @CurrentUser() user: User, @Req() req: Request) {
    await this.zeroDay.transition(id, String(body?.state ?? ''), body?.reason, this.actor(user, req));
    return this.zeroDay.view(id.trim().toUpperCase());
  }

  @Post('zero-days/:id/approve')
  @Permission('cyberdigest.review')
  @ApiOperation({ summary: 'Approve a zero-day as CONFIRMED. Refused unless the evidence rules are met.' })
  async approve(@Param('id') id: string, @CurrentUser() user: User, @Req() req: Request) {
    await this.zeroDay.approve(id, this.actor(user, req));
    return this.zeroDay.view(id.trim().toUpperCase());
  }

  @Post('zero-days/:id/withdraw')
  @Permission('cyberdigest.review')
  async withdraw(@Param('id') id: string, @Body() body: { state?: string; reason?: string }, @CurrentUser() user: User, @Req() req: Request) {
    await this.zeroDay.withdraw(id, String(body?.state ?? 'REPORTED_UNVERIFIED'), body?.reason, this.actor(user, req));
    return this.zeroDay.view(id.trim().toUpperCase());
  }

  // ------------------------------------------------------------------ stories

  @Get('stories')
  @Permission('cyberdigest.view')
  @ApiOperation({ summary: 'Stories with their publication state. Rejected stories are hidden unless asked for by state.' })
  async stories(
    @Query('q') q?: string, @Query('from') from?: string, @Query('to') to?: string, @Query('source') source?: string,
    @Query('category') category?: string, @Query('state') state?: string, @Query('take') take?: string, @Query('skip') skip?: string,
  ) {
    const gte = parseDate(from);
    const lte = parseDate(to);
    const where: any = { verificationState: { not: 'REJECTED' } };
    if (state && ['PENDING', 'ATTRIBUTED', 'VERIFIED', 'CONFLICTING', 'REJECTED', 'SOURCE_UNAVAILABLE'].includes(state)) where.verificationState = state;
    if (q) where.OR = [{ title: { contains: q.slice(0, 100), mode: 'insensitive' } }, { cveIds: { has: q.trim().toUpperCase().slice(0, 40) } }];
    if (gte || lte) where.publishedAt = { ...(gte && { gte }), ...(lte && { lte }) };
    if (source) where.source = { slug: source.slice(0, 60) };
    if (category && (CATEGORIES as readonly string[]).includes(category)) where.categories = { has: category };
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
    const ids = [...new Set(rows.flatMap((r) => r.cveIds))];
    const [cves, cases] = ids.length
      ? await Promise.all([
          this.prisma.digestCve.findMany({ where: { cveId: { in: ids } }, select: { cveId: true, recordStatus: true } }),
          this.prisma.digestZeroDayCase.findMany({ where: { cveId: { in: ids } }, select: { cveId: true, state: true } }),
        ])
      : [[], []];
    const status = new Map(cves.map((c) => [c.cveId, c.recordStatus]));
    const zd = new Map(cases.map((c) => [c.cveId, c.state]));
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
        summary: r.summary, // trimmed from the publisher's own text and checked against it
        categories: r.categories,
        // CVE ids as the publisher wrote them, each with what CVE.org says; null = not looked up yet.
        cves: r.cveIds.map((id) => ({ cveId: id, recordStatus: status.get(id) ?? null })),
        // Zero-day status comes only from the zero-day case, never from the article's wording.
        zeroDay: r.cveIds.filter((id) => zd.has(id) && zd.get(id) !== 'UNKNOWN').map((id) => ({ cveId: id, state: zd.get(id) })),
        verificationState: r.verificationState,
        stateNote: r.stateNote,
        lastVerifiedAt: r.lastVerifiedAt,
        reviewedAt: r.reviewedAt,
      })),
    };
  }

  @Post('stories/:id/approve')
  @Permission('cyberdigest.review')
  async approveStory(@Param('id') id: string, @Body() body: { reason?: string }, @CurrentUser() user: User, @Req() req: Request) {
    await this.storyReview.approve(id, body?.reason, this.actor(user, req));
    return { ok: true };
  }

  @Post('stories/:id/reject')
  @Permission('cyberdigest.review')
  async rejectStory(@Param('id') id: string, @Body() body: { reason?: string }, @CurrentUser() user: User, @Req() req: Request) {
    await this.storyReview.reject(id, body?.reason, this.actor(user, req));
    return { ok: true };
  }

  @Post('stories/:id/correct')
  @Permission('cyberdigest.review')
  async correctStory(@Param('id') id: string, @Body() body: { reason?: string }, @CurrentUser() user: User, @Req() req: Request) {
    await this.storyReview.correct(id, body?.reason, this.actor(user, req));
    return { ok: true };
  }

  // -------------------------------------------------------- verification overview

  @Get('verification')
  @Permission('cyberdigest.view')
  @ApiOperation({ summary: 'What is still unverified, disputed or corrected' })
  async verification() {
    const [pending, conflicting, nvdPending, cveUnavailable, cveConflicts, zdReported, zdUnknown, rejected, corrections] = await Promise.all([
      this.prisma.digestStory.count({ where: { verificationState: 'PENDING' } }),
      this.prisma.digestStory.findMany({ where: { verificationState: 'CONFLICTING' }, select: { id: true, title: true, canonicalUrl: true, stateNote: true }, take: 20, orderBy: { ingestedAt: 'desc' } }),
      this.prisma.digestCve.count({ where: { recordStatus: 'PUBLISHED', nvdEnrichment: { not: 'ENRICHED' } } }),
      this.prisma.digestCve.count({ where: { recordStatus: 'UNAVAILABLE' } }),
      this.prisma.digestCve.findMany({ where: { NOT: { conflicts: { equals: Prisma.DbNull } } }, select: { cveId: true, conflicts: true }, take: 20 }),
      this.prisma.digestZeroDayCase.count({ where: { state: 'REPORTED_UNVERIFIED' } }),
      this.prisma.digestZeroDayCase.count({ where: { state: 'UNKNOWN' } }),
      this.prisma.digestStory.findMany({ where: { verificationState: 'REJECTED' }, select: { id: true, title: true, canonicalUrl: true, stateNote: true, reviewedAt: true }, take: 20, orderBy: { reviewedAt: 'desc' } }),
      this.prisma.digestEvent.findMany({ where: { entityType: { in: ['STORY', 'ZERODAY'] }, event: { in: ['CORRECTED', 'WITHDRAWN', 'AUTO_DEMOTED'] } }, orderBy: { createdAt: 'desc' }, take: 20 }),
    ]);
    return {
      pendingStories: pending,
      conflictingStories: conflicting,
      cvesAwaitingNvd: nvdPending,
      cvesUnavailable: cveUnavailable,
      cveConflicts,
      zeroDayClaimsUnverified: zdReported,
      zeroDayStatusUnknown: zdUnknown,
      rejectedStories: rejected,
      corrections,
    };
  }

  // ------------------------------------------------------------ source management

  @Patch('sources/:slug')
  @Permission('cyberdigest.manage_sources')
  @ApiOperation({ summary: 'Enable/disable a source or change its poll interval' })
  async updateSource(@Param('slug') slug: string, @Body() body: { enabled?: boolean; pollIntervalMinutes?: number }, @CurrentUser() user: User, @Req() req: Request) {
    const source = await this.prisma.digestSource.findUnique({ where: { slug: slug.slice(0, 60) } });
    if (!source) throw new NotFoundException('Source not found');
    const data: { enabled?: boolean; pollIntervalMinutes?: number } = {};
    if (typeof body?.enabled === 'boolean') data.enabled = body.enabled;
    if (body?.pollIntervalMinutes !== undefined) {
      const n = Number(body.pollIntervalMinutes);
      if (!Number.isInteger(n) || n < 5 || n > 1440) throw new BadRequestException('Poll interval must be a whole number of minutes from 5 to 1440');
      data.pollIntervalMinutes = n;
    }
    if (!Object.keys(data).length) throw new BadRequestException('Nothing to change');
    await this.prisma.digestSource.update({ where: { slug: source.slug }, data });
    const a = this.actor(user, req);
    await this.audit.log({ actorId: a.id, action: 'CYBERDIGEST_SOURCE_UPDATED', targetType: 'DIGEST_SOURCE', targetId: source.id, details: { slug: source.slug, from: { enabled: source.enabled, pollIntervalMinutes: source.pollIntervalMinutes }, to: data }, ipAddress: a.ip, userAgent: a.userAgent });
    return { ok: true };
  }

  @Post('sources/:slug/poll')
  @Permission('cyberdigest.manage_sources')
  @ApiOperation({ summary: 'Poll one source now' })
  async pollNow(@Param('slug') slug: string) {
    return this.ingestion.pollSource(slug.slice(0, 60));
  }
}
