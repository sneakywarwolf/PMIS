import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { buildDigest, BuildInput, CveRow, groupStories, istDate, istMinutes, parseDigestTime, StoryRow } from './digest.builder';
import { DigestService } from './digest.service';
import { HealthWatchService } from './health-watch.service';

// ------------------------------------------------------------------------------------------------ builder

const T = (s: string) => new Date(s);
const NOW = T('2026-11-04T02:30:00Z'); // 08:00 IST
let n = 0;
const story = (o: Partial<StoryRow> = {}): StoryRow => ({
  id: `s${++n}`, title: `Unrelated headline number ${n} about something else entirely`, url: `https://n.example/${n}`, publisher: 'BleepingComputer', sourceSlug: 'bleepingcomputer',
  publishedAt: T('2026-11-03T20:00:00Z'), ingestedAt: T('2026-11-03T20:10:00Z'), summary: 'Publisher summary.', cveIds: [], categories: ['other'], state: 'ATTRIBUTED', ...o,
});
const cve = (id: string, o: Partial<CveRow> = {}): CveRow => ({ cveId: id, recordStatus: 'PUBLISHED', description: `${id} official text`, cvss: [], maxCvssSeverity: null, kevListed: false, nvdEnrichment: 'ENRICHED', ...o });
const base = (o: Partial<BuildInput> = {}): BuildInput => ({
  date: '2026-11-04', windowStart: T('2026-11-03T02:30:00Z'), windowEnd: NOW, stories: [], cves: new Map(), cveChanges: new Map(), kev: [], zeroDays: [], zeroDayStateByCve: new Map(),
  previous: { storyIds: new Set(), kevIds: new Set(), zeroDayCves: new Set() }, corrections: [], unhealthySources: [], counts: { pendingStories: 0, conflictingStories: 0, zeroDayUnverified: 0, cvesAwaitingNvd: 0 },
  kevRetrieved: true, verificationPassFailed: false, ...o,
});

describe('IST helpers', () => {
  it('uses the Asia/Kolkata calendar day', () => {
    expect(istDate(T('2026-11-03T18:29:59Z'))).toBe('2026-11-03');
    expect(istDate(T('2026-11-03T18:30:00Z'))).toBe('2026-11-04');
    expect(istMinutes(T('2026-11-04T02:30:00Z'))).toBe(8 * 60);
    expect(istMinutes(T('2026-11-03T18:30:00Z'))).toBe(0);
  });
  it('parses HH:MM and falls back on anything else', () => {
    expect(parseDigestTime('07:45')).toBe(465);
    for (const bad of ['7:45', '24:00', '08:60', 'noon', '', undefined]) expect(parseDigestTime(bad as any)).toBe(480);
  });
});

describe('buildDigest', () => {
  it('a day with nothing qualifying says so and invents nothing', () => {
    const c = buildDigest(base());
    expect(c.executiveSummary).toEqual({ lines: ['No qualifying verified updates found for this period.'], nothingQualified: true });
    expect([c.news, c.cves, c.kev, c.zeroDays, c.research.portswigger, c.research.cloudflare, c.corrections]).toEqual([[], [], [], [], [], [], []]);
    expect(c.limitations[0]).toMatch(/CERT-In/);
  });

  it('groups the same incident reported under different headlines and keeps every source link', () => {
    const a = story({ title: 'Hackers exploit Foo Server flaw to steal data', cveIds: ['CVE-2026-1111'], publisher: 'The Hacker News' });
    const b = story({ title: 'Foo Server bug abused in attacks', cveIds: ['CVE-2026-1111'], publisher: 'BleepingComputer' }); // shares the CVE
    const c = story({ title: 'Hackers exploit Foo Server flaw to steal data now', publisher: 'Cyber Security News' }); // near-identical headline, no CVE
    const d = story({ title: 'Completely different story about a conference' });
    const out = buildDigest(base({ stories: [a, b, c, d], cves: new Map([['CVE-2026-1111', cve('CVE-2026-1111')]]) }));
    expect(out.news).toHaveLength(2);
    const big = out.news.find((g) => g.sources.length === 3)!;
    expect(big.sources.map((s) => s.publisher).sort()).toEqual(['BleepingComputer', 'Cyber Security News', 'The Hacker News']);
    expect(big.rankReasons).toContain('reported by 3 publishers');
    expect(groupStories([a, d])).toHaveLength(2);
  });

  it('orders by the published policy: zero-day, KEV, analyst-verified, severity, then recency', () => {
    const plain = story({ title: 'Plain late story about some topic alpha', publishedAt: T('2026-11-04T01:00:00Z') });
    const critical = story({ title: 'Critical bug story bravo', cveIds: ['CVE-2026-2'] });
    const verified = story({ title: 'Verified story charlie delta', state: 'VERIFIED' });
    const kev = story({ title: 'Exploited bug story echo foxtrot', cveIds: ['CVE-2026-3'] });
    const zd = story({ title: 'Zero day story golf hotel', cveIds: ['CVE-2026-4'] });
    const out = buildDigest(base({
      stories: [plain, critical, verified, kev, zd],
      cves: new Map([['CVE-2026-2', cve('CVE-2026-2', { maxCvssSeverity: 'CRITICAL' })], ['CVE-2026-3', cve('CVE-2026-3', { kevListed: true })], ['CVE-2026-4', cve('CVE-2026-4')]]),
      zeroDayStateByCve: new Map([['CVE-2026-4', 'CONFIRMED']]),
    }));
    expect(out.news.map((g) => g.primaryStoryId)).toEqual([zd.id, kev.id, verified.id, critical.id, plain.id]);
    expect(out.news[0].rankReasons).toEqual(['cites a confirmed zero-day']);
    expect(out.rankPolicy.map((p) => p.reason)).toContain('cites a CVE listed in CISA KEV');
  });

  it('never shows or invents a numeric confidence/risk score', () => {
    const out = buildDigest(base({ stories: [story({ cveIds: ['CVE-2026-9'] })], cves: new Map([['CVE-2026-9', cve('CVE-2026-9', { kevListed: true })]]) }));
    const keys = JSON.stringify(out, (k, v) => (k === 'cvss' ? undefined : v));
    expect(keys).not.toMatch(/"(score|confidence|risk|weight|rank)"/i);
  });

  it('does not repeat items from earlier digests', () => {
    const old = story();
    const fresh = story({ title: 'A genuinely new story about zebras and quantum widgets' });
    const out = buildDigest(base({
      stories: [old, fresh],
      kev: [{ cveId: 'CVE-2026-7', vendorProject: 'V', product: 'P', name: 'N', dateAdded: T('2026-11-03'), dueDate: null, ransomwareUse: 'Unknown', shortDescription: 'd' }],
      zeroDays: [{ cveId: 'CVE-2026-8', description: 'd', approvedBy: 'a', approvedAt: T('2026-11-03T10:00:00Z'), evidence: [] }],
      previous: { storyIds: new Set([old.id]), kevIds: new Set(['CVE-2026-7']), zeroDayCves: new Set(['CVE-2026-8']) },
    }));
    expect(out.news.map((g) => g.primaryStoryId)).toEqual([fresh.id]);
    expect(out.kev).toEqual([]);
    expect(out.zeroDays).toEqual([]);
  });

  it('CVE section: new vs updated, only records CVE.org publishes', () => {
    const out = buildDigest(base({
      cves: new Map([['CVE-2026-1', cve('CVE-2026-1')], ['CVE-2026-2', cve('CVE-2026-2')], ['CVE-2026-3', cve('CVE-2026-3', { recordStatus: 'REJECTED' })], ['CVE-2026-4', cve('CVE-2026-4', { recordStatus: 'NOT_FOUND' })]]),
      cveChanges: new Map([['CVE-2026-1', ['FIRST_VERIFIED']], ['CVE-2026-2', ['CVSS_CHANGED', 'KEV_STATUS_CHANGED']], ['CVE-2026-3', ['FIRST_VERIFIED']], ['CVE-2026-4', ['FIRST_VERIFIED']], ['CVE-2026-5', ['FIRST_VERIFIED']]]),
    }));
    expect(out.cves.map((c) => [c.cveId, c.change])).toEqual([['CVE-2026-1', 'new'], ['CVE-2026-2', 'updated']]);
  });

  it('splits PortSwigger and Cloudflare research from news', () => {
    const out = buildDigest(base({ stories: [story(), story({ sourceSlug: 'portswigger-research', publisher: 'PortSwigger Research', title: 'Scalable vector grief research' }), story({ sourceSlug: 'cloudflare-blog', publisher: 'Cloudflare Blog', title: 'How we cut DNS delay' })] }));
    expect([out.news.length, out.research.portswigger.length, out.research.cloudflare.length]).toEqual([1, 1, 1]);
  });

  it('caps sections and says how many were left out', () => {
    const titles = ['Ransomware gang encrypts hospital network', 'Chrome update fixes sandbox escape', 'Router botnet targets home users', 'Phishing kit impersonates payroll portals', 'Supply chain attack hits npm maintainers'];
    const many = titles.map((title) => story({ title }));
    const out = buildDigest(base({ stories: many, limits: { news: 2 } }));
    expect(out.news).toHaveLength(2);
    expect(out.omitted.news).toBe(3);
  });

  it('states what it could not cover', () => {
    const out = buildDigest(base({
      unhealthySources: [{ name: 'BleepingComputer', health: 'FAILING', lastSuccessAt: null }, { name: 'The Hacker News', health: 'STALE', lastSuccessAt: T('2026-11-02T00:00:00Z') }],
      kevRetrieved: false, verificationPassFailed: true,
      counts: { pendingStories: 4, conflictingStories: 1, zeroDayUnverified: 2, cvesAwaitingNvd: 3 },
    }));
    const text = out.limitations.join('\n');
    expect(text).toMatch(/BleepingComputer is failing \(never checked successfully\)/);
    expect(text).toMatch(/The Hacker News is stale/);
    expect(text).toMatch(/KEV catalog has not been retrieved/);
    expect(text).toMatch(/verification pass .* failed/);
    expect(text).toMatch(/4 stories are awaiting verification/);
    expect(text).toMatch(/1 story has conflicting evidence/);
    expect(text).toMatch(/2 zero-day claims remain unverified/);
    expect(text).toMatch(/3 CVEs are awaiting NVD enrichment/);
  });

  it('executive summary is counts and labelled headlines, and separates verified from attributed', () => {
    const out = buildDigest(base({ stories: [story({ title: 'Headline one lorem', state: 'VERIFIED' }), story({ title: 'Another distinct matter entirely here' })] }));
    const text = out.executiveSummary.lines.join('\n');
    expect(text).toMatch(/2 stories in 2 topic groups \(1 verified by an analyst; the rest are attributed reporting, not independently confirmed\)/);
    expect(text).toMatch(/No confirmed zero-day exploitation alerts/);
    expect(text).toMatch(/Top story: “Headline one lorem”/);
  });

  it('turns later corrections into a visible section', () => {
    const out = buildDigest(base({ corrections: [{ kind: 'zero-day', ref: 'CVE-2026-8', event: 'AUTO_DEMOTED', reason: 'vendor advisory withdrawn', at: NOW }] }));
    expect(out.corrections[0].text).toBe('Zero-day status of CVE-2026-8 was auto demoted: vendor advisory withdrawn');
    expect(out.executiveSummary.nothingQualified).toBe(false);
  });
});

// ------------------------------------------------------------------------------------------------ service

function fakes() {
  const issues: any[] = [];
  const stories: any[] = [];
  const events: any[] = [];
  const sources: any[] = [{ slug: 'cisa-kev', name: 'CISA KEV', enabled: true, type: 'KEV_JSON', pollIntervalMinutes: 45, lastSuccessAt: NOW, consecutiveFailures: 0 }];
  const notified: any[] = [];
  const audits: any[] = [];
  const users = [{ id: 'u1', role: 'ADMIN', isActive: true }, { id: 'u2', role: 'TESTER', isActive: true }];
  let id = 0;
  const inWindow = (d: Date | null, c: any) => !!d && (!c?.gte || d >= c.gte) && (!c?.lte || d <= c.lte);
  const prisma: any = {
    issues, stories, events, sources,
    digestIssue: {
      findUnique: async ({ where }: any) => issues.find((i) => i.digestDate === where.digestDate) ?? null,
      findFirst: async ({ where }: any = {}) => issues.filter((i) => !where?.status || i.status === where.status).sort((a, b) => b.digestDate.localeCompare(a.digestDate))[0] ?? null,
      findMany: async ({ where }: any = {}) => issues.filter((i) => !where?.OR || where.OR.some((c: any) => (c.generatedAt?.gte ? i.generatedAt >= c.generatedAt.gte : c.id === i.id))).filter((i) => (!where?.status?.not || i.status !== where.status.not) && (!where?.status?.in || where.status.in.includes(i.status)) && (!where?.digestDate?.lt || i.digestDate < where.digestDate.lt)).sort((a, b) => b.digestDate.localeCompare(a.digestDate)),
      create: async ({ data }: any) => { if (issues.some((i) => i.digestDate === data.digestDate)) throw Object.assign(new Error('dup'), { code: 'P2002' }); const r = { id: `i${++id}`, publishedAt: null, withdrawnAt: null, withdrawReason: null, ...data }; issues.push(r); return r; },
      update: async ({ where, data }: any) => Object.assign(issues.find((i) => i.digestDate === where.digestDate), data),
      // Like the database: the status condition is evaluated together with the write.
      updateMany: async ({ where, data }: any) => {
        const hit = issues.filter((i) => i.digestDate === where.digestDate && (!where.status || (typeof where.status === 'string' ? i.status === where.status : where.status.in.includes(i.status))));
        hit.forEach((i) => Object.assign(i, data));
        return { count: hit.length };
      },
    },
    digestStory: {
      findMany: async ({ where }: any) => stories.filter((s) => {
        if (where.id?.in) return where.id.in.includes(s.id);
        if (where.verificationState?.in && !where.verificationState.in.includes(s.verificationState)) return false;
        return !where.OR || where.OR.some((c: any) => (c.publishedAt === null ? s.publishedAt === null && inWindow(s.ingestedAt, c.ingestedAt) : inWindow(s.publishedAt, c.publishedAt)));
      }).map((s) => ({ ...s, source: { name: s.publisher, slug: s.sourceSlug } })),
      count: async ({ where }: any) => stories.filter((s) => s.verificationState === where.verificationState).length,
    },
    digestEvent: { findMany: async () => events, create: async ({ data }: any) => { events.push({ ...data, createdAt: new Date() }); } },
    digestCve: { findMany: async () => [], count: async () => 0 },
    digestZeroDayCase: { findMany: async () => [], count: async () => 0 },
    digestKevEntry: { findMany: async () => [] },
    digestSource: { findMany: async () => sources },
    user: { findMany: async () => users },
  };
  const notifications = { create: async (d: any) => { notified.push(d); return d; } };
  const storyReview = { refresh: async () => 0 };
  const zeroDay: any = { syncKevCases: async () => 0, syncStoryClaims: async () => 0, recomputeAll: async () => 0, list: async () => [] };
  const audit = { log: async (a: any) => { audits.push(a); } };
  const conf: any = { timezone: "Asia/Kolkata", publishTime: "08:00", publishMode: "HOLD", minDiscoveryCoveragePct: 50, retentionDays: 365, linkHosts: ["news.example.org", "www.bleepingcomputer.com"], pipelineEnabled: true };
  const config = { get: async () => conf };
  const svc = new DigestService(prisma, audit as any, notifications as any, storyReview as any, zeroDay, config as any);
  const row = (o: any = {}) => ({ id: `row${++id}`, title: 'Foo bug', canonicalUrl: 'https://n.example/x', publisher: 'BleepingComputer', sourceSlug: 'bleepingcomputer', publishedAt: T('2026-11-03T20:00:00Z'), ingestedAt: T('2026-11-03T20:10:00Z'), summary: 's', cveIds: [], categories: ['other'], verificationState: 'ATTRIBUTED', stateNote: null, ...o });
  return { prisma, svc, notified, audits, stories, events, issues, row, storyReview, zeroDay, sources, users, conf };
}
const A = { id: 'u1', ip: '1.1.1.1', userAgent: 'jest' };
const withEnv = async (env: Record<string, string | undefined>, fn: () => Promise<void>) => {
  const before = { ...process.env };
  Object.entries(env).forEach(([k, v]) => (v === undefined ? delete process.env[k] : (process.env[k] = v)));
  try { await fn(); } finally { process.env = before; }
};

describe('DigestService', () => {
  it('only gate-passing stories get in: pending, conflicting and rejected never appear', async () => {
    const f = fakes();
    ['PENDING', 'CONFLICTING', 'REJECTED', 'SOURCE_UNAVAILABLE', 'ATTRIBUTED', 'VERIFIED'].forEach((st, i) => f.stories.push(f.row({ title: `Story number ${i} with unique words ${'abcdef'[i]}${i}x`, verificationState: st })));
    await f.svc.generate({ now: NOW });
    const c = f.issues[0].content;
    expect(c.news.flatMap((g: any) => g.sources.map((s: any) => s.state)).sort()).toEqual(['ATTRIBUTED', 'VERIFIED']);
  });

  it('an old article first ingested today stays out; an undated one is placed by its ingestion time', async () => {
    const f = fakes();
    f.stories.push(f.row({ title: 'Ancient article republished long ago', publishedAt: T('2026-09-01T00:00:00Z'), ingestedAt: NOW }));
    f.stories.push(f.row({ title: 'Undated but fresh lorem item', publishedAt: null, ingestedAt: T('2026-11-03T22:00:00Z') }));
    await f.svc.generate({ now: NOW });
    expect(f.issues[0].content.news.map((g: any) => g.headline)).toEqual(['Undated but fresh lorem item']);
  });

  it('defaults to shadow mode: stored for reviewers, nobody is notified', async () => {
    await withEnv({ CYBERDIGEST_DIGEST_MODE: undefined }, async () => {
      const f = fakes();
      f.stories.push(f.row());
      const m = await f.svc.generate({ now: NOW, actor: A });
      expect(m).toMatchObject({ status: 'SHADOW', date: '2026-11-04', generatedBy: 'analyst' });
      expect(f.notified).toEqual([]);
      expect(f.audits[0]).toMatchObject({ action: 'CYBERDIGEST_DIGEST_GENERATED' });
    });
  });

  it('automatic mode publishes with no human step and notifies every active user once', async () => {
    const f = fakes();
    f.conf.publishMode = 'AUTO';
    f.stories.push(f.row());
    const m = await f.svc.generate({ now: NOW });
    expect(m).toMatchObject({ status: 'PUBLISHED', generatedBy: 'schedule' });
    expect(f.notified.map((x) => x.userId).sort()).toEqual(['u1', 'u2']);
    expect(f.notified[0]).toMatchObject({ type: 'CYBERDIGEST_DIGEST', title: 'Cyberdigest for 2026-11-04', linkUrl: '/dashboard/cyberdigest' });
  });

  it('an administrator-triggered build is always held, even in automatic mode', async () => {
    const f = fakes();
    f.conf.publishMode = 'AUTO';
    expect((await f.svc.generate({ now: NOW, actor: A })).status).toBe('SHADOW');
    expect(f.notified).toEqual([]);
  });

  describe('publication gate (unattended runs)', () => {
    const discovery = (f: ReturnType<typeof fakes>, healthy: number, total: number) => {
      for (let i = 0; i < total; i++) f.sources.push({ slug: `feed${i}`, name: `Feed ${i}`, enabled: true, type: 'NEWS_RSS', pollIntervalMinutes: 20, lastSuccessAt: i < healthy ? NOW : null, consecutiveFailures: i < healthy ? 0 : 4 });
    };
    it('publishes with an explicit coverage notice when enough sources are healthy', async () => {
      const f = fakes();
      f.conf.publishMode = 'AUTO';
      discovery(f, 3, 4);
      const m = await f.svc.generate({ now: NOW });
      expect(m.status).toBe('PUBLISHED');
      const c = f.issues[0].content;
      expect(c.coverage).toEqual({ healthy: 3, total: 4, minPct: 50 });
      expect(c.limitations.join(' ')).toMatch(/Incomplete source coverage: only 3 of 4/);
    });
    it('says every source was checked only when every source was', async () => {
      const f = fakes();
      f.conf.publishMode = 'AUTO';
      discovery(f, 2, 2);
      await f.svc.generate({ now: NOW });
      expect(f.issues[0].content.limitations.join(' ')).toMatch(/All 2 news and research sources were checked successfully/);
    });
    it('refuses to publish below the coverage minimum: nothing is stored, the job fails and will retry', async () => {
      const f = fakes();
      f.conf.publishMode = 'AUTO';
      discovery(f, 1, 4);
      await expect(f.svc.generate({ now: NOW })).rejects.toThrow(/Not published: only 1 of 4/);
      expect(f.issues).toEqual([]);
      expect(f.notified).toEqual([]);
    });
    it('refuses to publish when the KEV catalog was never retrieved or the verification pass failed', async () => {
      const f = fakes();
      f.conf.publishMode = 'AUTO';
      f.sources[0].lastSuccessAt = null;
      await expect(f.svc.generate({ now: NOW })).rejects.toThrow(/KEV catalog has not been retrieved/);
      const g = fakes();
      g.conf.publishMode = 'AUTO';
      g.storyReview.refresh = async () => { throw new Error('db down'); };
      await expect(g.svc.generate({ now: NOW })).rejects.toThrow(/verification pass failed/);
    });
    it('a day with every required source healthy and nothing new publishes the no-updates notice', async () => {
      const f = fakes();
      f.conf.publishMode = 'AUTO';
      discovery(f, 2, 2);
      await f.svc.generate({ now: NOW });
      expect(f.issues[0]).toMatchObject({ status: 'PUBLISHED' });
      expect(f.issues[0].content.executiveSummary.nothingQualified).toBe(true);
    });
    it('an administrator can still look at a degraded digest: it is built, held, and flagged', async () => {
      const f = fakes();
      discovery(f, 1, 4);
      expect((await f.svc.generate({ now: NOW, actor: A })).status).toBe('SHADOW');
    });
  });

  it('latest(): the newest published digest with its age; a previous one is flagged stale, never replaced by an empty one', async () => {
    const f = fakes();
    f.conf.publishMode = 'AUTO';
    f.stories.push(f.row());
    await f.svc.generate({ now: NOW });
    const same = await f.svc.latest(false, new Date(NOW.getTime() + 3600_000));
    expect(same).toMatchObject({ stale: false, publishedFor: '2026-11-04' });
    const later = await f.svc.latest(false, new Date(NOW.getTime() + 30 * 3600_000));
    expect(later).toMatchObject({ stale: true, publishedFor: '2026-11-04' });
    expect(later.ageHours).toBeGreaterThan(29);
    expect(later.latest!.content!.news.length).toBe(1);
    const none = await fakes().svc.latest(false);
    expect(none).toMatchObject({ latest: null, stale: true });
  });

  it('links in a stored digest are re-validated on every read: an off-list host is delivered as text, a hostile URL as nothing', async () => {
    const f = fakes();
    f.conf.publishMode = 'AUTO';
    f.stories.push(f.row({ canonicalUrl: "https://news.example.org/ok" }));
    await f.svc.generate({ now: NOW });
    const src = f.issues[0].content.news[0].sources[0];
    expect(f.issues[0].content.news[0].sources[0].url).toBe("https://news.example.org/ok");
    f.issues[0].content.news[0].sources[0].url = 'javascript:alert(1)'; // tampered storage
    f.issues[0].content.news.push({ ...f.issues[0].content.news[0], sources: [{ ...src, url: 'https://evil.example.net/x' }] });
    const view = await f.svc.get('2026-11-04', false);
    expect(view.content!.news[0].sources[0]).toMatchObject({ url: null, urlHost: null });
    expect(view.content!.news[1].sources[0]).toMatchObject({ url: null, urlHost: "evil.example.net" });
  });

  it('retention removes old digests but always keeps the newest published one', async () => {
    const f = fakes();
    f.conf.retentionDays = 30;
    (f.prisma as any).digestIssue.deleteMany = async ({ where }: any) => {
      const gone = f.issues.filter((i) => i.generatedAt < where.generatedAt.lt && (!where.id?.not || i.id !== where.id.not));
      gone.forEach((g) => f.issues.splice(f.issues.indexOf(g), 1));
      return { count: gone.length };
    };
    (f.prisma as any).digestIssue.findFirst = async () => f.issues.filter((i) => i.status === 'PUBLISHED').sort((a, b) => b.digestDate.localeCompare(a.digestDate))[0] ?? null;
    (f.prisma as any).digestJobRun = { deleteMany: async () => ({ count: 2 }) };
    const old = new Date(NOW.getTime() - 200 * 86_400_000);
    // Collected material: old stories go, except one the newest digest still points at; recent ones stay.
    const gone: any[] = [];
    f.stories.push(f.row({ id: 'old-unlinked', ingestedAt: old }), f.row({ id: 'old-linked', ingestedAt: old }), f.row({ id: 'linked-by-older-digest', ingestedAt: new Date(NOW.getTime() - 31 * 86_400_000) }), f.row({ id: 'recent', ingestedAt: new Date(NOW.getTime() - 86_400_000) }));
    (f.prisma as any).digestStory.deleteMany = async ({ where }: any) => {
      const hit = f.stories.filter((s) => s.ingestedAt < where.ingestedAt.lt && (!where.id?.notIn || !where.id.notIn.includes(s.id)));
      hit.forEach((h) => { f.stories.splice(f.stories.indexOf(h), 1); gone.push(h.id); });
      return { count: hit.length };
    };
    (f.prisma as any).digestRawItem = { deleteMany: async ({ where }: any) => { expect(where.fetchedAt.lt).toEqual(new Date(NOW.getTime() - 30 * 86_400_000)); return { count: 4 }; } };
    let eventFilter: any;
    (f.prisma as any).digestEvent.deleteMany = async ({ where }: any) => { eventFilter = where; return { count: 6 }; }; // zero-day and CVE history are never pruned
    // 'd' is recent enough to survive and links a story that is older than the cutoff; 'c' is the newest published digest.
    f.issues.push({ id: 'a', digestDate: '2026-04-01', status: 'PUBLISHED', generatedAt: old, content: {} }, { id: 'b', digestDate: '2026-04-02', status: 'PUBLISHED', generatedAt: old, content: {} },
      { id: 'd', digestDate: '2026-10-20', status: 'PUBLISHED', generatedAt: new Date(NOW.getTime() - 15 * 86_400_000), content: { news: [{ sources: [{ storyId: 'linked-by-older-digest' }] }] } },
      { id: 'c', digestDate: '2026-11-03', status: 'PUBLISHED', generatedAt: new Date(NOW.getTime() - 86_400_000), content: { news: [{ sources: [{ storyId: 'old-linked' }] }] } });
    expect(await f.svc.pruneOld(NOW)).toEqual({ digests: 2, runs: 2, stories: 1, rawItems: 4, events: 6 });
    expect(gone).toEqual(['old-unlinked']);
    expect(f.stories.map((s) => s.id).sort()).toEqual(['linked-by-older-digest', 'old-linked', 'recent']); // every surviving digest keeps its stories
    expect(eventFilter.entityType.in).toEqual(['STORY', 'SOURCE', 'JOB']);
    expect(eventFilter.NOT.entityType).toBe('STORY'); // their correction history is kept too
    expect([...eventFilter.NOT.entityId.in].sort()).toEqual(['linked-by-older-digest', 'old-linked']);
    expect(f.issues.map((i) => i.id).sort()).toEqual(['c', 'd']);
  });

  it('a shadow digest can be regenerated, a published one cannot', async () => {
    const f = fakes();
    await f.svc.generate({ now: NOW });
    f.stories.push(f.row({ title: 'Added after the first run lorem' }));
    await f.svc.generate({ now: NOW });
    expect(f.issues).toHaveLength(1);
    expect(f.issues[0].content.news).toHaveLength(1);
    await f.svc.publish('2026-11-04', A);
    await expect(f.svc.generate({ now: NOW })).rejects.toBeInstanceOf(ConflictException);
  });

  it('a digest published while it is being regenerated is never overwritten (check and write are one conditional statement)', async () => {
    const f = fakes();
    f.stories.push(f.row());
    await f.svc.generate({ now: NOW });
    const frozen = JSON.stringify(f.issues[0].content);
    f.stories.push(f.row({ title: 'Arrives while the regeneration runs lorem' }));
    f.storyReview.refresh = async () => { await f.svc.publish('2026-11-04', A); return 0; }; // someone publishes mid-pass
    await expect(f.svc.generate({ now: NOW })).rejects.toBeInstanceOf(ConflictException);
    expect(f.issues[0].status).toBe('PUBLISHED');
    expect(JSON.stringify(f.issues[0].content)).toBe(frozen);
  });

  it('two people publishing at once notify everyone exactly once; two withdrawals record one', async () => {
    const f = fakes();
    await f.svc.generate({ now: NOW });
    const results = await Promise.allSettled([f.svc.publish('2026-11-04', A), f.svc.publish('2026-11-04', { ...A, id: 'u2' })]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(f.notified).toHaveLength(2); // two active users, once
    const w = await Promise.allSettled([f.svc.withdraw('2026-11-04', 'first reviewer reason', A), f.svc.withdraw('2026-11-04', 'second reviewer reason', { ...A, id: 'u2' })]);
    expect(w.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(f.audits.filter((a) => a.action === 'CYBERDIGEST_DIGEST_WITHDRAWN')).toHaveLength(1);
  });

  it('publish: shadow -> published with notification, audited, and not repeatable', async () => {
    const f = fakes();
    await f.svc.generate({ now: NOW });
    expect(f.notified).toHaveLength(0);
    await f.svc.publish('2026-11-04', A);
    expect(f.issues[0]).toMatchObject({ status: 'PUBLISHED', publishedById: 'u1' });
    expect(f.notified).toHaveLength(2);
    expect(f.audits.at(-1)).toMatchObject({ action: 'CYBERDIGEST_DIGEST_PUBLISHED' });
    await expect(f.svc.publish('2026-11-04', A)).rejects.toBeInstanceOf(ConflictException);
    await expect(f.svc.publish('2026-11-05', A)).rejects.toBeInstanceOf(NotFoundException);
    await expect(f.svc.publish('not-a-date', A)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('withdraw needs a reason; everyone else then sees only the fact of the withdrawal', async () => {
    const f = fakes();
    await f.svc.generate({ now: NOW });
    await f.svc.publish('2026-11-04', A);
    await expect(f.svc.withdraw('2026-11-04', 'no', A)).rejects.toBeInstanceOf(BadRequestException);
    await f.svc.withdraw('2026-11-04', 'a headline turned out to be wrong', A);
    expect(f.audits.at(-1)).toMatchObject({ action: 'CYBERDIGEST_DIGEST_WITHDRAWN', details: { reason: 'a headline turned out to be wrong', was: 'PUBLISHED' } });
    const viewer = await f.svc.get('2026-11-04', false);
    expect(viewer.content).toBeNull();
    expect(viewer.meta).toMatchObject({ status: 'WITHDRAWN', withdrawReason: 'a headline turned out to be wrong' });
    expect((await f.svc.get('2026-11-04', true)).content).not.toBeNull();
    await expect(f.svc.withdraw('2026-11-04', 'again for no reason', A)).rejects.toBeInstanceOf(ConflictException);
  });

  it('shadow digests are invisible to non-reviewers', async () => {
    const f = fakes();
    await f.svc.generate({ now: NOW });
    expect(await f.svc.list(false)).toEqual([]);
    expect(await f.svc.list(true)).toHaveLength(1);
    await expect(f.svc.get('2026-11-04', false)).rejects.toBeInstanceOf(NotFoundException);
    expect((await f.svc.get('2026-11-04', true)).meta.status).toBe('SHADOW');
  });

  it('a story rejected after publication is flagged on top of the frozen digest, which stays unedited', async () => {
    const f = fakes();
    const s = f.row();
    f.stories.push(s);
    await f.svc.generate({ now: NOW });
    await f.svc.publish('2026-11-04', A);
    const before = JSON.stringify(f.issues[0].content);
    s.verificationState = 'REJECTED';
    s.stateNote = 'publisher retracted it';
    const view = await f.svc.get('2026-11-04', false);
    expect(view.overlay!.storyFlags[s.id]).toEqual({ state: 'REJECTED', note: 'publisher retracted it' });
    expect(JSON.stringify(f.issues[0].content)).toBe(before);
  });

  it('records a failed verification pass in the digest instead of hiding it', async () => {
    const f = fakes();
    f.storyReview.refresh = async () => { throw new Error('boom'); };
    await f.svc.generate({ now: NOW, actor: A });
    expect(f.issues[0].content.limitations.join(' ')).toMatch(/verification pass .* failed/);
  });

  it('lists unhealthy sources among the limitations', async () => {
    const f = fakes();
    f.sources.push({ slug: 'bleepingcomputer', name: 'BleepingComputer', enabled: true, type: 'NEWS_RSS', pollIntervalMinutes: 20, lastSuccessAt: null, consecutiveFailures: 5 });
    await f.svc.generate({ now: NOW, actor: A });
    expect(f.issues[0].content.limitations.join(' ')).toMatch(/BleepingComputer is failing/);
  });

  it('window: 24h for the first digest, then from the previous digest, capped at 72h after an outage', async () => {
    const f = fakes();
    await f.svc.generate({ now: NOW });
    expect(new Date(f.issues[0].windowStart).getTime()).toBe(NOW.getTime() - 24 * 3600_000);
    await f.svc.publish('2026-11-04', A);
    const next = new Date(NOW.getTime() + 24 * 3600_000);
    await f.svc.generate({ now: next });
    expect(new Date(f.issues[1].windowStart).getTime()).toBe(NOW.getTime());
    const later = new Date(NOW.getTime() + 10 * 24 * 3600_000);
    await f.svc.generate({ now: later });
    expect(new Date(f.issues[2].windowStart).getTime()).toBe(later.getTime() - 72 * 3600_000);
  });

  it('a withdrawn digest does not swallow its items: they can appear in the next one', async () => {
    const f = fakes();
    f.stories.push(f.row({ ingestedAt: T('2026-11-03T20:10:00Z') }));
    await f.svc.generate({ now: NOW });
    await f.svc.withdraw('2026-11-04', 'withdrawn for testing', A);
    await f.svc.generate({ now: new Date(NOW.getTime() + 24 * 3600_000) });
    expect(f.issues[1].content.news).toHaveLength(1);
  });

  it('schedule: nothing before the configured IST time, once after it, never twice', async () => {
      const f = fakes(); f.conf.publishTime = "09:30";
      expect(await f.svc.runScheduled(T('2026-11-04T03:59:00Z'))).toBe(false); // 09:29 IST
      expect(await f.svc.runScheduled(T('2026-11-04T04:00:00Z'))).toBe(true); // 09:30 IST
      expect(await f.svc.runScheduled(T('2026-11-04T05:00:00Z'))).toBe(false);
      expect(f.issues).toHaveLength(1);
      expect(f.issues[0].digestDate).toBe('2026-11-04');
      expect(await f.svc.runScheduled(T('2026-11-05T04:00:00Z'))).toBe(true); // next day
  });

  it('schedule: a late start (service down at the scheduled time) still produces the digest', async () => {
    const f = fakes();
    expect(await f.svc.runScheduled(T('2026-11-04T11:00:00Z'))).toBe(true); // 16:30 IST
  });

  it('schedule follows the administrator-chosen time zone', async () => {
    const f = fakes();
    f.conf.timezone = 'America/New_York';
    f.conf.publishTime = '08:00';
    expect(await f.svc.runScheduled(T('2026-11-04T12:59:00Z'))).toBe(false); // 07:59 EST
    expect(await f.svc.runScheduled(T('2026-11-04T13:00:00Z'))).toBe(true); // 08:00 EST
    expect(f.issues[0].digestDate).toBe('2026-11-04');
  });

  it('a lost race with another instance is a conflict, not a crash', async () => {
    const f = fakes();
    const orig = f.prisma.digestIssue.create;
    f.prisma.digestIssue.create = async (a: any) => { f.issues.push({ id: 'other', digestDate: a.data.digestDate, status: 'SHADOW' }); return orig(a); };
    await expect(f.svc.generate({ now: NOW })).rejects.toBeInstanceOf(ConflictException);
  });
});

// ------------------------------------------------------------------------------------------------ source alerts

describe('HealthWatchService', () => {
  function setup() {
    const events: any[] = [];
    const notified: any[] = [];
    const sources: any[] = [{ id: 'sid', slug: 'bleepingcomputer', name: 'BleepingComputer', enabled: true, type: 'NEWS_RSS', pollIntervalMinutes: 20, lastSuccessAt: null, consecutiveFailures: 0, lastError: null }];
    const prisma: any = {
      digestSource: { findMany: async () => sources },
      digestEvent: {
        findFirst: async () => [...events].reverse()[0] ?? null,
        create: async ({ data }: any) => { events.push({ ...data, createdAt: clock }); },
      },
      user: { findMany: async ({ where }: any) => [{ id: 'admin', role: 'ADMIN', isActive: true }, { id: 'tester', role: 'TESTER', isActive: true }].filter((u) => !where?.role || u.role === where.role) },
    };
    let clock = T('2026-11-04T00:00:00Z');
    const svc = new HealthWatchService(prisma, { create: async (d: any) => { notified.push(d); } } as any);
    return { svc, sources, notified, events, at: (d: Date) => { clock = d; return d; } };
  }

  it('alerts once when a source starts failing, only to people who can manage sources', async () => {
    const h = setup();
    expect(await h.svc.check(h.at(T('2026-11-04T00:00:00Z')))).toEqual([]);
    h.sources[0].consecutiveFailures = 2;
    expect(await h.svc.check(h.at(T('2026-11-04T00:10:00Z')))).toEqual([]); // two failures is a blip
    h.sources[0].consecutiveFailures = 3;
    h.sources[0].lastError = 'http: HTTP 503';
    expect(await h.svc.check(h.at(T('2026-11-04T00:20:00Z')))).toEqual(['bleepingcomputer:FAILING']);
    expect(h.notified.map((n) => n.userId)).toEqual(['admin']);
    expect(h.notified[0]).toMatchObject({ type: 'CYBERDIGEST_SOURCE_DOWN', title: 'BleepingComputer is failing' });
    expect(h.notified[0].message).toMatch(/http: HTTP 503/);
    expect(await h.svc.check(h.at(T('2026-11-04T00:30:00Z')))).toEqual([]); // no repeat the same day
    expect(await h.svc.check(h.at(T('2026-11-05T00:30:00Z')))).toEqual(['bleepingcomputer:FAILING']); // reminder after 24h
  });

  it('sends one note on recovery, and flags a source that has gone stale', async () => {
    const h = setup();
    h.sources[0].lastSuccessAt = T('2026-11-03T00:00:00Z'); // a day ago, interval 20 min -> stale
    expect(await h.svc.check(h.at(T('2026-11-04T00:00:00Z')))).toEqual(['bleepingcomputer:STALE']);
    h.sources[0].lastSuccessAt = T('2026-11-04T00:05:00Z');
    expect(await h.svc.check(h.at(T('2026-11-04T00:10:00Z')))).toEqual(['bleepingcomputer:RECOVERED']);
    expect(h.notified.at(-1)).toMatchObject({ title: 'BleepingComputer has recovered' });
    expect(await h.svc.check(h.at(T('2026-11-04T00:15:00Z')))).toEqual([]);
  });

  it('disabled sources are never alerted on', async () => {
    const h = setup();
    h.sources[0].enabled = false;
    h.sources[0].consecutiveFailures = 9;
    h.sources.splice(0, 1, ...h.sources.filter((s) => s.enabled)); // the real query filters enabled: true
    expect(await h.svc.check()).toEqual([]);
  });
});
