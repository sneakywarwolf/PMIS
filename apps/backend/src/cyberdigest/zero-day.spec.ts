import { BadRequestException, ConflictException } from '@nestjs/common';
import { evaluate, EvidenceItem } from './zero-day.engine';
import { ZeroDayService, Actor } from './zero-day.service';

const D = (s: string) => new Date(`${s}T00:00:00Z`);
let n = 0;
const ev = (kind: string, sourceType: string, eventDate: string | null, extra: Partial<EvidenceItem> = {}): EvidenceItem => ({
  id: `e${++n}`, kind, sourceType, sourceName: extra.sourceName ?? `${sourceType}-${n}`, url: `https://example.com/${n}`, eventDate: eventDate ? D(eventDate) : null, retracted: false, ...extra,
});
const PUB = { cvePublished: true };

describe('zero-day engine: what must NOT make a confirmed zero-day', () => {
  it('a headline alone (news claim) is only a reported, unverified zero-day', () => {
    const r = evaluate([ev('ZERO_DAY_CLAIM', 'NEWS', '2026-11-01')], PUB);
    expect(r).toMatchObject({ suggested: 'REPORTED_UNVERIFIED', eligible: false, exploitationEstablished: false });
    expect(r.missing.join(' ')).toMatch(/exploitation/);
  });
  it('news saying exploitation happened (secondary source) establishes nothing', () => {
    const r = evaluate([ev('ZERO_DAY_CLAIM', 'NEWS', null), ev('EXPLOITATION_OBSERVED', 'NEWS', '2026-10-01'), ev('NO_PATCH_AVAILABLE', 'NEWS', '2026-10-02')], PUB);
    expect(r).toMatchObject({ suggested: 'REPORTED_UNVERIFIED', eligible: false, exploitationEstablished: false });
  });
  it('CISA KEV alone: known exploited, never a zero-day (KEV gives no exploitation date)', () => {
    const r = evaluate([ev('EXPLOITATION_OBSERVED', 'GOVERNMENT', null, { sourceName: 'CISA KEV' })], PUB);
    expect(r).toMatchObject({ suggested: 'KNOWN_EXPLOITED_UNCONFIRMED', eligible: false, exploitationEstablished: true });
  });
  it('KEV plus a zero-day headline still is not confirmed', () => {
    const r = evaluate([ev('EXPLOITATION_OBSERVED', 'GOVERNMENT', null, { sourceName: 'CISA KEV' }), ev('ZERO_DAY_CLAIM', 'NEWS', null)], PUB);
    expect(r).toMatchObject({ suggested: 'KNOWN_EXPLOITED_UNCONFIRMED', eligible: false });
  });
  it('a public proof of concept without exploitation evidence is nothing', () => {
    const r = evaluate([ev('POC_PUBLIC', 'RESEARCHER', '2026-10-20'), ev('ZERO_DAY_CLAIM', 'NEWS', null)], PUB);
    expect(r).toMatchObject({ suggested: 'REPORTED_UNVERIFIED', eligible: false, exploitationEstablished: false });
  });
  it('an unpatched vulnerability with no exploitation or timeline is not a zero-day', () => {
    const r = evaluate([ev('NO_PATCH_AVAILABLE', 'VENDOR', '2026-10-20')], PUB);
    expect(r).toMatchObject({ suggested: 'UNKNOWN', eligible: false, exploitationEstablished: false });
  });
  it('exploitation without a stated date cannot confirm', () => {
    const r = evaluate([ev('EXPLOITATION_OBSERVED', 'VENDOR', null), ev('NO_PATCH_AVAILABLE', 'VENDOR', '2026-10-20')], PUB);
    expect(r.eligible).toBe(false);
    expect(r.missing.join(' ')).toMatch(/date/);
  });
  it('exploitation with no evidence about patch status cannot confirm', () => {
    const r = evaluate([ev('EXPLOITATION_OBSERVED', 'VENDOR', '2026-10-10')], PUB);
    expect(r).toMatchObject({ eligible: false, suggested: 'KNOWN_EXPLOITED_UNCONFIRMED' });
    expect(r.missing.join(' ')).toMatch(/no patch/);
  });
  it('exploitation dated on or after the patch is not a zero-day, but the exploitation fact stays', () => {
    const r = evaluate([ev('ZERO_DAY_CLAIM', 'NEWS', null), ev('EXPLOITATION_OBSERVED', 'VENDOR', '2026-10-15'), ev('PATCH_RELEASED', 'VENDOR', '2026-10-15')], PUB);
    expect(r).toMatchObject({ eligible: false, suggested: 'KNOWN_EXPLOITED_UNCONFIRMED' });
    expect(r.reasons.join(' ')).toMatch(/on or after the patch/);
  });
  it('no published CVE record means no confirmation', () => {
    const r = evaluate([ev('EXPLOITATION_OBSERVED', 'VENDOR', '2026-10-10'), ev('PATCH_RELEASED', 'VENDOR', '2026-10-20')], { cvePublished: false });
    expect(r.eligible).toBe(false);
    expect(r.missing.join(' ')).toMatch(/CVE/);
  });
  it('retracted evidence is ignored', () => {
    const r = evaluate([ev('EXPLOITATION_OBSERVED', 'VENDOR', '2026-10-10', { retracted: true }), ev('PATCH_RELEASED', 'VENDOR', '2026-10-20')], PUB);
    expect(r).toMatchObject({ exploitationEstablished: false, eligible: false });
  });
});

describe('zero-day engine: what qualifies', () => {
  it('vendor statement of exploitation before the patch -> eligible (still needs approval), never suggested CONFIRMED', () => {
    const r = evaluate([ev('EXPLOITATION_OBSERVED', 'VENDOR', '2026-10-10'), ev('PATCH_RELEASED', 'VENDOR', '2026-10-20')], PUB);
    expect(r).toMatchObject({ eligible: true, suggested: 'KNOWN_EXPLOITED_UNCONFIRMED' });
    expect(r.suggested).not.toBe('CONFIRMED');
  });
  it('exploitation with a primary statement that no patch existed afterwards -> eligible', () => {
    expect(evaluate([ev('EXPLOITATION_OBSERVED', 'INCIDENT_REPORT', '2026-10-10'), ev('NO_PATCH_AVAILABLE', 'VENDOR', '2026-10-12')], PUB).eligible).toBe(true);
  });
  it('"no patch" dated BEFORE the exploitation does not cover the exploitation', () => {
    expect(evaluate([ev('EXPLOITATION_OBSERVED', 'VENDOR', '2026-10-10'), ev('NO_PATCH_AVAILABLE', 'VENDOR', '2026-10-01')], PUB).eligible).toBe(false);
  });
});

describe('zero-day engine: conflicts and contradictions', () => {
  it('conflicting exploitation dates that decide the outcome -> UNKNOWN, not eligible', () => {
    const r = evaluate([ev('EXPLOITATION_OBSERVED', 'VENDOR', '2026-10-10', { sourceName: 'Vendor' }), ev('EXPLOITATION_OBSERVED', 'RESEARCHER', '2026-10-25', { sourceName: 'Lab' }), ev('PATCH_RELEASED', 'VENDOR', '2026-10-20')], PUB);
    expect(r).toMatchObject({ eligible: false, suggested: 'UNKNOWN' });
    expect(r.conflicts[0]).toMatch(/disagree/);
  });
  it('different dates that do not change the outcome are not a conflict', () => {
    const r = evaluate([ev('EXPLOITATION_OBSERVED', 'VENDOR', '2026-10-10', { sourceName: 'Vendor' }), ev('EXPLOITATION_OBSERVED', 'RESEARCHER', '2026-10-12', { sourceName: 'Lab' }), ev('PATCH_RELEASED', 'VENDOR', '2026-10-20')], PUB);
    expect(r.conflicts).toEqual([]);
    expect(r.eligible).toBe(true);
  });
  it('a primary source denying exploitation that others report -> conflict, UNKNOWN', () => {
    const r = evaluate([ev('EXPLOITATION_OBSERVED', 'RESEARCHER', '2026-10-10'), ev('CONTRADICTS_EXPLOITATION', 'VENDOR', null), ev('PATCH_RELEASED', 'VENDOR', '2026-10-20')], PUB);
    expect(r).toMatchObject({ eligible: false, suggested: 'UNKNOWN' });
  });
  it('a vendor denying exploitation of a claimed zero-day -> not substantiated', () => {
    const r = evaluate([ev('ZERO_DAY_CLAIM', 'NEWS', null), ev('CONTRADICTS_EXPLOITATION', 'VENDOR', '2026-10-30')], PUB);
    expect(r.suggested).toBe('NOT_SUBSTANTIATED');
  });
  it('a primary source contradicting the zero-day label blocks confirmation even if exploitation is real', () => {
    const r = evaluate([ev('EXPLOITATION_OBSERVED', 'VENDOR', '2026-10-10'), ev('PATCH_RELEASED', 'VENDOR', '2026-10-20'), ev('CONTRADICTS_ZERO_DAY', 'VENDOR', null)], PUB);
    expect(r).toMatchObject({ eligible: false, suggested: 'KNOWN_EXPLOITED_UNCONFIRMED' });
  });
  it('a secondary source contradicting does not override primary evidence', () => {
    const r = evaluate([ev('EXPLOITATION_OBSERVED', 'VENDOR', '2026-10-10'), ev('PATCH_RELEASED', 'VENDOR', '2026-10-20'), ev('CONTRADICTS_ZERO_DAY', 'NEWS', null)], PUB);
    expect(r.eligible).toBe(true);
  });
});

// ---------------------------------------------------------------- service

function fakes(cve: any = { cveId: 'CVE-2026-0001', recordStatus: 'PUBLISHED', description: 'd', kevListed: false }) {
  const cases: any[] = [];
  const evidence: any[] = [];
  const events: any[] = [];
  const audits: any[] = [];
  const stories: any[] = [];
  const cves: any[] = cve ? [cve] : [];
  let i = 0;
  const withEv = (c: any) => (c ? { ...c, evidence: evidence.filter((e) => e.caseId === c.id) } : null);
  const prisma: any = {
    cases, evidence, events, stories, cves,
    digestZeroDayCase: {
      findUnique: async ({ where, include }: any) => { const c = cases.find((x) => x.cveId === where.cveId); return include ? withEv(c) : c ?? null; },
      create: async ({ data }: any) => { const c = { id: `c${++i}`, stateSetById: null, approvedById: null, approvedAt: null, createdAt: new Date(), updatedAt: new Date(), stateSetAt: new Date(), ...data }; cases.push(c); return c; },
      update: async ({ where, data }: any) => Object.assign(cases.find((x) => x.cveId === where.cveId), data),
      // Like the database: the state condition is checked together with the write.
      updateMany: async ({ where, data }: any) => {
        const hit = cases.filter((x) => x.cveId === where.cveId && (!where.state || x.state === where.state));
        hit.forEach((x) => Object.assign(x, data));
        return { count: hit.length };
      },
      findMany: async ({ select }: any = {}) => cases.map((c) => (select ? { cveId: c.cveId } : withEv(c))),
    },
    digestZeroDayEvidence: {
      count: async ({ where }: any) => evidence.filter((e) => e.caseId === where.caseId).length,
      create: async ({ data }: any) => { const e = { id: `ev${++i}`, createdAt: new Date(i), retractedAt: null, retractedById: null, retractReason: null, ...data }; evidence.push(e); return e; },
      findUnique: async ({ where }: any) => { const e = evidence.find((x) => x.id === where.id); return e ? { ...e, case: cases.find((c) => c.id === e.caseId) } : null; },
      update: async ({ where, data }: any) => Object.assign(evidence.find((x) => x.id === where.id), data),
      findFirst: async ({ where }: any) => evidence.find((e) => e.caseId === where.caseId && (!where.sourceName || e.sourceName === where.sourceName) && (!where.url || e.url === where.url) && (!where.kind || e.kind === where.kind) && (where.addedById === undefined || e.addedById === where.addedById) && (where.system === undefined || e.system === where.system) && !e.retractedAt) ?? null,
    },
    digestCve: { findUnique: async ({ where }: any) => cves.find((c) => c.cveId === where.cveId) ?? null, findMany: async ({ where }: any) => cves.filter((c) => (where?.kevListed === undefined || c.kevListed === where.kevListed) && (!where?.cveId?.in || where.cveId.in.includes(c.cveId))) },
    digestEvent: { create: async ({ data }: any) => { events.push(data); } },
    digestStory: { findMany: async () => stories },
    user: { findMany: async () => [{ id: 'u1', username: 'analyst' }, { id: 'u2', username: 'second' }] },
  };
  const audit = { log: async (a: any) => { audits.push(a); } };
  return { prisma, svc: new ZeroDayService(prisma, audit as any), audits };
}
const U: Actor = { id: 'u1', ip: '127.0.0.1', userAgent: 'jest' };
const ID = 'CVE-2026-0001';
const qualifying = async (svc: ZeroDayService) => {
  await svc.addEvidence(ID, { kind: 'EXPLOITATION_OBSERVED', sourceType: 'VENDOR', sourceName: 'Vendor', url: 'https://vendor.example/advisory', eventDate: '2026-10-10' }, U);
  await svc.addEvidence(ID, { kind: 'PATCH_RELEASED', sourceType: 'VENDOR', sourceName: 'Vendor', url: 'https://vendor.example/patch', eventDate: '2026-10-20' }, U);
};

describe('ZeroDayService', () => {
  it('approval is refused unless the evidence qualifies, and lists what is missing', async () => {
    const { svc, prisma } = fakes();
    await svc.addEvidence(ID, { kind: 'ZERO_DAY_CLAIM', sourceType: 'NEWS', sourceName: 'Some News', url: 'https://news.example/a' }, U);
    await expect(svc.approve(ID, U)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.cases[0]).toMatchObject({ state: 'REPORTED_UNVERIFIED', approvedAt: null });
  });

  it('qualifying evidence makes the case eligible but NOT confirmed until an analyst approves', async () => {
    const { svc, prisma, audits } = fakes();
    await qualifying(svc);
    expect(prisma.cases[0].state).toBe('KNOWN_EXPLOITED_UNCONFIRMED');
    expect((await svc.view(ID)).eligibleForConfirmation).toBe(true);
    expect((await svc.list('confirmed'))).toHaveLength(0);
    await svc.approve(ID, U);
    expect(prisma.cases[0]).toMatchObject({ state: 'CONFIRMED', approvedById: 'u1' });
    expect(prisma.cases[0].approvedAt).toBeInstanceOf(Date);
    const confirmed = await svc.list('confirmed');
    expect(confirmed).toHaveLength(1);
    expect(confirmed[0]).toMatchObject({ publishedAsConfirmed: true, approvedBy: 'analyst' });
    expect(audits.map((a) => a.action)).toContain('CYBERDIGEST_ZERODAY_APPROVED');
    expect(prisma.events.map((e: any) => e.event)).toEqual(expect.arrayContaining(['CASE_OPENED', 'EVIDENCE_ADDED', 'APPROVED']));
  });

  it('an analyst decision made on a stale view is refused instead of overwriting a concurrent change', async () => {
    const { svc, prisma } = fakes();
    await qualifying(svc);
    const real = prisma.digestZeroDayCase.findUnique;
    // Between this analyst loading the case and saving, a second analyst approves it.
    const changeBehindTheirBack = (to: string) => async (a: any) => { const seen = await real(a); const stored = prisma.cases.find((x: any) => x.cveId === a.where.cveId); if (stored) stored.state = to; return seen; };
    prisma.digestZeroDayCase.findUnique = changeBehindTheirBack('CONFIRMED');
    await expect(svc.transition(ID, 'UNKNOWN', 'I think this is unclear', U)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.cases[0].state).toBe('CONFIRMED');
    prisma.digestZeroDayCase.findUnique = real;
    // approve() racing a transition: the loser must not leave a second, unaudited state change behind.
    prisma.cases[0].state = 'KNOWN_EXPLOITED_UNCONFIRMED';
    prisma.digestZeroDayCase.findUnique = changeBehindTheirBack('UNKNOWN');
    await expect(svc.approve(ID, U)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.cases[0].approvedAt).toBeNull();
  });

  it('a case cannot be moved to CONFIRMED by transition()', async () => {
    const { svc } = fakes();
    await qualifying(svc);
    await expect(svc.transition(ID, 'CONFIRMED', 'because I say so', U)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('retracting the qualifying evidence demotes a confirmed case immediately and clears the approval', async () => {
    const { svc, prisma } = fakes();
    await qualifying(svc);
    await svc.approve(ID, U);
    const patch = prisma.evidence.find((e: any) => e.kind === 'PATCH_RELEASED');
    await svc.retractEvidence(patch.id, 'advisory was withdrawn by the vendor', U);
    expect(prisma.cases[0]).toMatchObject({ state: 'KNOWN_EXPLOITED_UNCONFIRMED', approvedById: null, approvedAt: null });
    expect(await svc.list('confirmed')).toHaveLength(0);
    expect(prisma.events.map((e: any) => e.event)).toContain('AUTO_DEMOTED');
  });

  it('a "confirmed" row that no longer qualifies is never shown as confirmed, even before a recompute', async () => {
    const { svc, prisma } = fakes();
    await qualifying(svc);
    await svc.approve(ID, U);
    prisma.evidence.find((e: any) => e.kind === 'PATCH_RELEASED').retractedAt = new Date(); // changed behind the service's back
    expect(await svc.list('confirmed')).toHaveLength(0);
  });

  it('a CONFIRMED row with no recorded approver is not published', async () => {
    const { svc, prisma } = fakes();
    await qualifying(svc);
    prisma.cases[0].state = 'CONFIRMED'; // tampered: no approvedBy / approvedAt
    expect(await svc.list('confirmed')).toHaveLength(0);
  });

  it('withdrawal needs a reason, is recorded, and removes the approval', async () => {
    const { svc, prisma, audits } = fakes();
    await qualifying(svc);
    await svc.approve(ID, U);
    await expect(svc.withdraw(ID, 'UNKNOWN', '', U)).rejects.toBeInstanceOf(BadRequestException);
    await svc.withdraw(ID, 'REPORTED_UNVERIFIED', 'vendor corrected its advisory', { ...U, id: 'u2' });
    expect(prisma.cases[0]).toMatchObject({ state: 'REPORTED_UNVERIFIED', approvedById: null, stateSetById: 'u2' });
    expect(audits.at(-1)).toMatchObject({ action: 'CYBERDIGEST_ZERODAY_WITHDRAWN', actorId: 'u2' });
    expect((await svc.view(ID)).analystReason).toBe('vendor corrected its advisory');
  });

  it('an analyst-placed state is respected by later recomputes, but only analysts can place it', async () => {
    const { svc, prisma } = fakes();
    await svc.addEvidence(ID, { kind: 'ZERO_DAY_CLAIM', sourceType: 'NEWS', sourceName: 'News', url: 'https://news.example/a' }, U);
    await svc.transition(ID, 'UNKNOWN', 'vendor advisory is behind a login, cannot assess', U);
    await svc.recompute(ID);
    expect(prisma.cases[0]).toMatchObject({ state: 'UNKNOWN', stateSetById: 'u1' });
    await expect(svc.transition(ID, 'KNOWN_EXPLOITED_UNCONFIRMED', 'looks exploited to me', U)).rejects.toBeInstanceOf(ConflictException); // no primary exploitation evidence
  });

  it('input validation: unknown kinds, non-http links, bad or future dates, malformed CVE ids', async () => {
    const { svc } = fakes();
    const ok = { kind: 'DISCLOSURE', sourceType: 'VENDOR', sourceName: 'V', url: 'https://v.example/a' };
    await expect(svc.addEvidence('not-a-cve', ok, U)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.addEvidence(ID, { ...ok, kind: 'MADE_UP' }, U)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.addEvidence(ID, { ...ok, sourceType: 'AI_CONFIDENCE' }, U)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.addEvidence(ID, { ...ok, url: 'javascript:alert(1)' }, U)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.addEvidence(ID, { ...ok, sourceName: '  ' }, U)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.addEvidence(ID, { ...ok, eventDate: 'yesterday-ish' }, U)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.addEvidence(ID, { ...ok, eventDate: '2999-01-01' }, U)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('KEV sync opens a known-exploited case with undated KEV evidence, idempotently, and never confirms', async () => {
    const { svc, prisma } = fakes({ cveId: ID, recordStatus: 'PUBLISHED', kevListed: true });
    expect(await svc.syncKevCases()).toBe(1);
    expect(await svc.syncKevCases()).toBe(0);
    await svc.recomputeAll();
    expect(prisma.cases[0].state).toBe('KNOWN_EXPLOITED_UNCONFIRMED');
    expect(prisma.evidence).toHaveLength(1);
    expect(prisma.evidence[0]).toMatchObject({ sourceName: 'CISA KEV', eventDate: null, addedById: null, system: true });
    await expect(svc.approve(ID, U)).rejects.toBeInstanceOf(ConflictException);
  });

  it('people cannot enter evidence under the system KEV name, and a look-alike row does not stop the real KEV evidence being recorded', async () => {
    const { svc, prisma } = fakes({ cveId: ID, recordStatus: 'PUBLISHED', kevListed: true });
    for (const name of ['CISA KEV', 'cisa-kev', ' CISA  KEV ', 'KEV']) {
      await expect(svc.addEvidence(ID, { kind: 'EXPLOITATION_OBSERVED', sourceType: 'GOVERNMENT', sourceName: name, url: 'https://x.example/a' }, U)).rejects.toBeInstanceOf(BadRequestException);
    }
    await svc.ensureCase(ID);
    prisma.evidence.push({ id: 'fake', caseId: prisma.cases[0].id, kind: 'EXPLOITATION_OBSERVED', sourceType: 'GOVERNMENT', sourceName: 'CISA KEV', url: 'https://x.example/a', eventDate: null, addedById: null, system: false, retractedAt: null }); // no author, but not written by the sync: must not count as system evidence // e.g. inserted by other means
    expect(await svc.syncKevCases()).toBe(1);
    expect(prisma.evidence.filter((e: any) => e.sourceName === 'CISA KEV' && e.system === true)).toHaveLength(1);
    expect((await svc.view(ID)).evidence.map((e: any) => e.addedBy).sort()).toEqual(['system', 'unattributed']); // the look-alike is not shown as system evidence
  });

  it('story claims: a "zero-day" headline opens only a REPORTED case; articles naming many CVEs are not attributed', async () => {
    const { svc, prisma } = fakes();
    const story = (cveIds: string[], title: string) => ({ cveIds, title, summary: null, canonicalUrl: `https://news.example/${title.length}`, publishedAt: new Date('2026-11-01'), source: { name: 'News Site' } });
    prisma.stories.push(story([ID], 'Attackers exploit zero-day in Foo'), story(['CVE-2026-0002', 'CVE-2026-0003', 'CVE-2026-0004', 'CVE-2026-0005'], 'Patch Tuesday zero-day roundup'), story(['CVE-2026-0009'], 'Boring routine bug'));
    expect(await svc.syncStoryClaims()).toBe(1);
    await svc.recomputeAll();
    expect(prisma.cases).toHaveLength(1);
    expect(prisma.cases[0]).toMatchObject({ cveId: ID, state: 'REPORTED_UNVERIFIED' });
    expect(prisma.evidence[0]).toMatchObject({ kind: 'ZERO_DAY_CLAIM', sourceType: 'NEWS' });
    expect(await svc.syncStoryClaims()).toBe(0);
  });

  it('a case for a CVE that CVE.org does not publish can never be approved', async () => {
    const { svc } = fakes({ cveId: ID, recordStatus: 'NOT_FOUND' });
    await qualifying(svc);
    await expect(svc.approve(ID, U)).rejects.toBeInstanceOf(ConflictException);
  });

  it('a conflicting-evidence case is parked as UNKNOWN and cannot be approved', async () => {
    const { svc, prisma } = fakes();
    await qualifying(svc);
    await svc.addEvidence(ID, { kind: 'EXPLOITATION_OBSERVED', sourceType: 'RESEARCHER', sourceName: 'Lab', url: 'https://lab.example/x', eventDate: '2026-10-25' }, U);
    expect(prisma.cases[0].state).toBe('UNKNOWN');
    await expect(svc.approve(ID, U)).rejects.toBeInstanceOf(ConflictException);
  });
});
