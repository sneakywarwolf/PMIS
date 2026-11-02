import { BadRequestException, ConflictException } from '@nestjs/common';
import { validateSummary } from './summary-guard';
import { categorize } from './classify';
import { decideStoryState, StoryReviewService } from './story-review.service';
import { extractiveSummary } from './normalize';

const EVIDENCE = 'Attackers exploited a flaw tracked as CVE-2026-1234 in Foo Server 2.4.1 on October 12. The vendor released a patch. CVSS 9.8.';

describe('summary guard: a summary may only carry facts that are in the evidence', () => {
  it('accepts a faithful trim', () => {
    expect(validateSummary('Attackers exploited a flaw tracked as CVE-2026-1234 in Foo Server 2.4.1 on October 12.', EVIDENCE)).toEqual({ ok: true, unsupported: [] });
    expect(validateSummary(extractiveSummary(EVIDENCE)!, EVIDENCE).ok).toBe(true);
  });
  it('rejects an unsupported CVE', () => expect(validateSummary('Exploited CVE-2026-9999 in Foo Server.', EVIDENCE)).toMatchObject({ ok: false, unsupported: ['CVE-2026-9999'] }));
  it('rejects an unsupported score', () => expect(validateSummary('Rated CVSS 10.0.', EVIDENCE).unsupported).toContain('10.0'));
  it('rejects an unsupported version', () => expect(validateSummary('Affects Foo Server 2.5.0.', EVIDENCE).unsupported).toContain('2.5.0'));
  it('rejects an unsupported date', () => {
    expect(validateSummary('Attacks began on November 3.', EVIDENCE).ok).toBe(false);
    expect(validateSummary('Attacks began on 2026-11-03.', EVIDENCE).ok).toBe(false);
  });
  it('rejects an exploitation or zero-day claim the evidence does not make', () => {
    const quiet = 'Researchers described a bug in Foo Server.';
    expect(validateSummary('The bug is being exploited in the wild.', quiet).unsupported).toContain('exploitation claim');
    expect(validateSummary('A new zero-day hits Foo Server.', quiet).unsupported).toContain('zero-day claim');
    expect(validateSummary('The vendor shipped a patch.', quiet).unsupported).toContain('patch claim');
  });
  it('allows a claim the evidence itself makes', () => {
    expect(validateSummary('Actively exploited zero-day in Foo.', 'Foo hit by an actively exploited zero-day').ok).toBe(true);
  });
  it('is case- and whitespace-insensitive for facts that are present', () => {
    expect(validateSummary('cve-2026-1234   affects  Foo', 'CVE-2026-1234 affects Foo').ok).toBe(true);
  });
});

describe('categorize', () => {
  it('labels by the publisher text and keeps several labels', () => {
    expect(categorize('LockBit ransomware gang hits hospital', '', 'bleepingcomputer')).toContain('ransomware');
    expect(categorize('New botnet', 'infostealer malware', 'x')).toContain('malware');
    expect(categorize('Data breach exposes 2M records', '', 'x')).toContain('breach');
    expect(categorize('Critical RCE in Foo (CVE-2026-1234)', '', 'x')).toContain('vulnerability');
    expect(categorize('Stored XSS in a web application', '', 'x')).toContain('appsec');
    expect(categorize('Misconfigured AWS S3 bucket', '', 'x')).toContain('cloud');
    expect(categorize('APT29 campaign targets diplomats', '', 'x')).toContain('threat-intel');
  });
  it('uses the source remit for research blogs, and falls back to other', () => {
    expect(categorize('Scalable Vector Grief', '', 'portswigger-research')).toEqual(['appsec']);
    expect(categorize('How we cut DNS build delay', '', 'cloudflare-blog')).toEqual(['cloud']);
    expect(categorize('Company announces conference', '', 'thehackernews')).toEqual(['other']);
  });
});

describe('decideStoryState', () => {
  const m = (o: Record<string, string>) => new Map(Object.entries(o));
  it('no CVEs: attributed reporting', () => expect(decideStoryState([], m({}))).toEqual({ state: 'ATTRIBUTED', note: null }));
  it('CVEs confirmed by CVE.org: still attributed, never auto-verified', () => expect(decideStoryState(['CVE-2026-1'], m({ 'CVE-2026-1': 'PUBLISHED' })).state).toBe('ATTRIBUTED'));
  it('unresolved CVEs: pending', () => {
    for (const s of [undefined, 'UNAVAILABLE', 'RESERVED']) expect(decideStoryState(['CVE-2026-1'], m(s ? { 'CVE-2026-1': s } : {})).state).toBe('PENDING');
  });
  it('a rejected or unknown-to-CVE.org CVE: conflicting, with the reason', () => {
    expect(decideStoryState(['CVE-2026-1'], m({ 'CVE-2026-1': 'REJECTED' }))).toMatchObject({ state: 'CONFLICTING', note: expect.stringMatching(/rejected/) });
    expect(decideStoryState(['CVE-2026-1', 'CVE-2026-2'], m({ 'CVE-2026-1': 'PUBLISHED', 'CVE-2026-2': 'NOT_FOUND' }))).toMatchObject({ state: 'CONFLICTING', note: expect.stringMatching(/CVE-2026-2 has no public/) });
  });
});

function fakes(cves: Record<string, string> = {}) {
  const stories: any[] = [];
  const events: any[] = [];
  const audits: any[] = [];
  const prisma: any = {
    stories, events,
    digestStory: {
      findMany: async () => stories.filter((s) => ['PENDING', 'ATTRIBUTED', 'CONFLICTING', 'VERIFIED'].includes(s.verificationState)),
      findUnique: async ({ where }: any) => stories.find((s) => s.id === where.id) ?? null,
      update: async ({ where, data }: any) => Object.assign(stories.find((s) => s.id === where.id), data),
    },
    digestCve: { findMany: async ({ where }: any) => Object.entries(cves).filter(([id]) => where.cveId.in.includes(id)).map(([cveId, recordStatus]) => ({ cveId, recordStatus })) },
    digestEvent: { create: async ({ data }: any) => { events.push(data); } },
  };
  const svc = new StoryReviewService(prisma, { log: async (a: any) => { audits.push(a); } } as any);
  const add = (o: any = {}) => { const s = { id: `s${stories.length + 1}`, title: 't', summary: 'x', canonicalUrl: 'https://n.example/a', cveIds: [], categories: ['other'], verificationState: 'PENDING', stateNote: null, reviewedById: null, reviewedAt: null, ingestedAt: new Date(), ...o }; stories.push(s); return s; };
  return { prisma, svc, add, audits, cves };
}
const A = { id: 'u1', ip: '1.1.1.1', userAgent: 'jest' };

describe('StoryReviewService', () => {
  it('refresh: sets states from CVE facts, fills missing categories, and logs only real changes', async () => {
    const { svc, add, prisma } = fakes({ 'CVE-2026-1': 'PUBLISHED', 'CVE-2026-2': 'REJECTED' });
    const a = add({ cveIds: [] });
    const b = add({ cveIds: ['CVE-2026-1'] });
    const c = add({ cveIds: ['CVE-2026-2'] });
    const d = add({ cveIds: ['CVE-2026-3'], categories: [], title: 'Ransomware gang strikes' });
    expect(await svc.refresh()).toBe(3); // d stays PENDING: its state does not change, only its categories are filled in
    expect([a, b, c, d].map((s) => s.verificationState)).toEqual(['ATTRIBUTED', 'ATTRIBUTED', 'CONFLICTING', 'PENDING']);
    expect(d.categories).toContain('ransomware');
    expect(await svc.refresh()).toBe(0);
    expect(prisma.events).toHaveLength(3);
  });

  it('approve works only when every cited CVE is confirmed, needs a reason, and is audited', async () => {
    const { svc, add, audits } = fakes({ 'CVE-2026-1': 'PUBLISHED' });
    const ok = add({ cveIds: ['CVE-2026-1'], verificationState: 'ATTRIBUTED' });
    const unresolved = add({ cveIds: ['CVE-2026-9'] });
    await expect(svc.approve(ok.id, '', A)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.approve(unresolved.id, 'checked the vendor advisory', A)).rejects.toBeInstanceOf(ConflictException);
    await svc.approve(ok.id, 'checked the vendor advisory', A);
    expect(ok).toMatchObject({ verificationState: 'VERIFIED', reviewedById: 'u1' });
    expect(audits[0]).toMatchObject({ action: 'CYBERDIGEST_STORY_APPROVED', actorId: 'u1' });
  });

  it('a verified story is demoted the moment its CVE evidence turns bad, and the approval is cleared', async () => {
    const { svc, add, cves } = fakes({ 'CVE-2026-1': 'PUBLISHED' });
    const s = add({ cveIds: ['CVE-2026-1'], verificationState: 'ATTRIBUTED' });
    await svc.approve(s.id, 'checked the vendor advisory', A);
    await svc.refresh();
    expect(s.verificationState).toBe('VERIFIED');
    cves['CVE-2026-1'] = 'REJECTED';
    await svc.refresh();
    expect(s).toMatchObject({ verificationState: 'CONFLICTING', reviewedById: null, reviewedAt: null });
  });

  it('reject hides the story from refresh; correct restores the evidence-based state with the correction on record', async () => {
    const { svc, add, audits, prisma } = fakes({});
    const s = add({ verificationState: 'ATTRIBUTED' });
    await svc.reject(s.id, 'article retracted by the publisher', A);
    expect(s.verificationState).toBe('REJECTED');
    await svc.refresh();
    expect(s.verificationState).toBe('REJECTED'); // refresh never un-rejects
    await expect(svc.approve(s.id, 'trying anyway', A)).rejects.toBeInstanceOf(ConflictException);
    await svc.correct(s.id, 'publisher reinstated the article', A);
    expect(s).toMatchObject({ verificationState: 'ATTRIBUTED', stateNote: 'Corrected: publisher reinstated the article' });
    await svc.refresh();
    expect(s.stateNote).toMatch(/^Corrected:/); // the explanation is not wiped by the next pass
    expect(prisma.events.map((e: any) => e.event)).toEqual(expect.arrayContaining(['REJECTED', 'CORRECTED']));
    expect(audits.map((a) => a.action)).toEqual(['CYBERDIGEST_STORY_REJECTED', 'CYBERDIGEST_STORY_CORRECTED']);
    await expect(svc.correct(s.id, 'nothing to correct here', A)).rejects.toBeInstanceOf(ConflictException);
  });
});
