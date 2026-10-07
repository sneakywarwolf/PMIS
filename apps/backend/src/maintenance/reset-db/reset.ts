import { PrismaClient, Prisma } from '@prisma/client';
import { ResetScope, isEverything } from './scopes';
import {
  DEFAULT_ADMIN_USERNAME,
  DEFAULT_TEAM_LEAD_USERNAME,
  DEFAULT_USERNAMES,
  DEFAULT_USERS,
  hashDefaultPasswords,
  loadDefaultVulnerabilities,
  SeedVulnerability,
} from './defaults';

/** Object storage (MinIO) as the reset sees it. Swapped for a fake in tests. */
export interface ResetStorage {
  list(prefix: string): Promise<string[]>;
  remove(keys: string[]): Promise<void>;
}

/** Redis-side state: login sessions and the report-generation job queue. */
export interface ResetCache {
  clearSessionKeys(): Promise<number>;
  clearReportQueue(): Promise<void>;
}

export interface ResetDeps {
  prisma: PrismaClient;
  storage: ResetStorage;
  cache: ResetCache;
  log: (msg: string) => void;
}

/** Thrown with the failed stage's name so the CLI can say exactly where it stopped. */
export class ResetStageError extends Error {
  constructor(public readonly stage: string, public readonly original: unknown) {
    super(`Stage "${stage}" failed: ${original instanceof Error ? original.message : String(original)}`);
  }
}

const QUIZ_NOTIFICATIONS = ['QUIZ_QUESTION_LIVE', 'QUIZ_ANSWER_REVEALED'] as const;
const VULN_NOTIFICATIONS = [
  'VULNERABILITY_REQUESTED',
  'VULNERABILITY_APPROVED',
  'VULNERABILITY_REJECTED',
  'VULNERABILITY_EDITED',
  'VULNERABILITY_CHANGE_REQUESTED',
  'VULNERABILITY_CHANGE_APPROVED',
  'VULNERABILITY_CHANGE_REJECTED',
] as const;

/** What each scope touches in each store — used by both execution and the confirmation screen. */
export function footprint(scopes: ResetScope[]) {
  const all = isEverything(scopes);
  const has = (s: ResetScope) => all || scopes.includes(s);
  return {
    all,
    quiz: has('quiz'),
    projects: has('projects'),
    vulns: has('vulnerabilities'),
    users: has('users'),
    // Findings need both a project and a vulnerability, so either scope removes them.
    findings: has('projects') || has('vulnerabilities'),
    // Prefix sweeps in object storage
    storagePrefixes: all ? [''] : [...(has('projects') || has('vulnerabilities') ? ['poc/'] : []), ...(has('projects') ? ['reports/'] : [])],
    sessions: has('users'),
    queue: has('projects'),
  };
}

export interface ImpactLine {
  label: string;
  count: number | string;
}

/** Live counts for the confirmation screen: exactly what will be deleted / changed. */
export async function describeImpact(
  prisma: PrismaClient,
  storage: ResetStorage,
  scopes: ResetScope[],
): Promise<{ deleted: ImpactLine[]; changed: ImpactLine[]; restored: string[] }> {
  const f = footprint(scopes);
  const deleted: ImpactLine[] = [];
  const changed: ImpactLine[] = [];
  const restored: string[] = [];
  const doomed = { username: { notIn: DEFAULT_USERNAMES } };

  if (f.quiz) {
    deleted.push(
      { label: 'Quiz questions', count: await prisma.quizQuestion.count() },
      { label: 'Quiz answers / history', count: await prisma.quizAttempt.count() },
      { label: 'Quiz scores & badges', count: await prisma.quizUserStats.count() },
      { label: 'Arcade (Pattern Map) scores & leaderboard', count: await prisma.patternMapScore.count() },
    );
  }
  if (f.projects) {
    deleted.push(
      { label: 'Projects (incl. network scope, nmap data, custom fields)', count: await prisma.project.count() },
      { label: 'Generated reports (incl. issue logs)', count: await prisma.reportGeneration.count() },
    );
  }
  if (f.findings) {
    deleted.push(
      { label: 'Findings', count: await prisma.finding.count() },
      { label: 'PoC steps', count: await prisma.pocStep.count() },
    );
  }
  if (f.vulns) {
    deleted.push(
      { label: 'Vulnerabilities', count: await prisma.vulnerability.count() },
      { label: 'Vulnerability change requests', count: await prisma.vulnerabilityChangeRequest.count() },
    );
    restored.push(`Default vulnerability dataset (${loadDefaultVulnerabilities().length} entries)`);
  }
  if (f.all) {
    deleted.push(
      { label: 'Report templates & field mappings', count: await prisma.reportTemplate.count() },
      { label: 'Audit log entries', count: await prisma.auditLog.count() },
      { label: 'Notifications', count: await prisma.notification.count() },
      { label: 'Saved application settings (reverts to defaults)', count: await prisma.appSettings.count() },
    );
  }
  if (f.users) {
    deleted.push({ label: 'Users (everyone except the 4 default accounts)', count: await prisma.user.count({ where: doomed }) });
    if (!f.all) {
      // Rows that survive but pointed at a removed user are handed to the default admin.
      const owners = { in: (await prisma.user.findMany({ where: doomed, select: { id: true } })).map((u) => u.id) };
      if (!f.projects) changed.push({ label: 'Projects reassigned to default admin', count: await prisma.project.count({ where: { OR: [{ testerId: owners }, { tlId: owners }] } }) });
      if (!f.findings) changed.push({ label: 'Findings reassigned to default admin', count: await prisma.finding.count({ where: { createdById: owners } }) });
      // Only stores that survive this reset can have rows to reassign.
      const surviving: [boolean, string, Promise<number>][] = [
        [!f.projects, 'Generated reports reassigned to default admin', prisma.reportGeneration.count({ where: { generatedById: owners } })],
        [!f.all, 'Report templates reassigned to default admin', prisma.reportTemplate.count({ where: { uploadedById: owners } })],
        [!f.quiz, 'Quiz questions reassigned to default admin', prisma.quizQuestion.count({ where: { createdById: owners } })],
        [!f.vulns, 'Vulnerability change requests reassigned to default admin', prisma.vulnerabilityChangeRequest.count({ where: { requestedById: owners } })],
      ];
      for (const [applies, label, count] of surviving) {
        if (applies) changed.push({ label, count: await count });
        else await count; // settle the promise either way
      }
      if (!f.quiz) {
        deleted.push({ label: 'Quiz answers & scores belonging to removed users', count:
          (await prisma.quizAttempt.count({ where: { userId: owners } })) + (await prisma.quizUserStats.count({ where: { userId: owners } })) + (await prisma.patternMapScore.count({ where: { userId: owners } })) });
      }
      deleted.push({ label: 'Audit log entries authored by removed users', count: await prisma.auditLog.count({ where: { actorId: owners } }) });
    }
    restored.push('Default accounts: admin, teamlead, tester1, tester2 (default passwords, must change on first login)');
    restored.push('All login sessions are signed out');
  }

  const storageKeys = new Set<string>();
  for (const p of f.storagePrefixes) for (const k of await storage.list(p)) storageKeys.add(k);
  if (f.storagePrefixes.length) {
    deleted.push({
      label: f.all ? 'Stored files (entire storage bucket)' : `Stored files under ${f.storagePrefixes.join(', ')}`,
      count: storageKeys.size,
    });
  }
  if (f.queue) deleted.push({ label: 'Queued report-generation jobs', count: 'all' });

  return { deleted, changed, restored };
}

type Tx = Prisma.TransactionClient;

/** Everything that happens to the database, as one all-or-nothing transaction. */
async function resetDatabase(
  tx: Tx,
  scopes: ResetScope[],
  hashes: Record<string, string>,
  vulns: SeedVulnerability[],
): Promise<void> {
  const f = footprint(scopes);

  // 1. Leaf data first. Order respects the RESTRICT foreign keys.
  if (f.quiz) {
    await tx.quizAttempt.deleteMany();
    await tx.quizUserStats.deleteMany();
    await tx.patternMapScore.deleteMany();
    await tx.quizQuestion.deleteMany();
    await tx.notification.deleteMany({ where: { type: { in: [...QUIZ_NOTIFICATIONS] } } });
  }
  if (f.findings) {
    await tx.pocStep.deleteMany();
    await tx.finding.deleteMany();
  }
  if (f.projects) {
    await tx.reportGeneration.deleteMany();
    await tx.project.deleteMany();
  }
  if (f.vulns) {
    await tx.vulnerabilityChangeRequest.deleteMany();
    await tx.vulnerability.deleteMany();
    await tx.notification.deleteMany({ where: { type: { in: [...VULN_NOTIFICATIONS] } } });
  }
  if (f.all) {
    await tx.templateField.deleteMany();
    await tx.reportTemplate.deleteMany();
    await tx.auditLog.deleteMany();
    await tx.notification.deleteMany();
    await tx.appSettings.deleteMany();
  }

  // 2. Defaults
  if (f.vulns) {
    await tx.vulnerability.createMany({
      data: vulns.map((v) => ({
        name: v.name,
        severity: v.severity,
        cvssScore: v.cvssScore,
        cvssVector: v.cvssVector,
        description: v.description,
        impact: v.impact,
        remediation: v.remediation,
        references: v.references,
        source: 'imported',
      })),
    });
  }

  // 3. Users last: remove everyone except the defaults, then put the defaults back in their seed state.
  let adminId: string | null = null;
  if (f.users) {
    adminId = await resetUsers(tx, hashes);
  }

  // 4. Leave a trace (the only audit row after "Everything").
  if (!adminId) {
    adminId = (await tx.user.findUnique({ where: { username: DEFAULT_ADMIN_USERNAME }, select: { id: true } }))?.id ?? null;
  }
  if (adminId) {
    await tx.auditLog.create({
      data: {
        actorId: adminId,
        action: 'ADMIN_OVERRIDE',
        targetType: 'DB_RESET',
        ipAddress: 'cli',
        userAgent: 'reset-db',
        details: { action: 'application_reset', scopes },
      },
    });
  }
}

/** Returns the default admin's id. */
async function resetUsers(tx: Tx, hashes: Record<string, string>): Promise<string> {
  const defaultState = (u: (typeof DEFAULT_USERS)[number], tlId: string | null) => ({
    email: u.email,
    passwordHash: hashes[u.username],
    role: u.role,
    isActive: true,
    isForcePasswordChange: true,
    assignedTlId: u.underTeamLead ? tlId : null,
    managerId: null,
    fullName: null,
    phone: null,
    designation: null,
    deletedAt: null,
    totpSecret: null,
    isTotpEnabled: false,
    lastLoginAt: null,
  });
  const upsertDefault = async (u: (typeof DEFAULT_USERS)[number], tlId: string | null) =>
    tx.user.upsert({
      where: { username: u.username },
      update: defaultState(u, tlId),
      create: { username: u.username, ...defaultState(u, tlId) },
      select: { id: true },
    });

  const [adminDef, tlDef, ...testerDefs] = DEFAULT_USERS;
  const admin = await upsertDefault(adminDef, null);

  const doomed = (await tx.user.findMany({ where: { username: { notIn: DEFAULT_USERNAMES } }, select: { id: true } })).map((u) => u.id);
  if (doomed.length) {
    const ids = { in: doomed };
    // Rows that must survive (other scopes weren't selected) are handed to the default admin.
    await tx.project.updateMany({ where: { testerId: ids }, data: { testerId: admin.id } });
    await tx.project.updateMany({ where: { tlId: ids }, data: { tlId: admin.id } });
    await tx.finding.updateMany({ where: { createdById: ids }, data: { createdById: admin.id } });
    await tx.reportGeneration.updateMany({ where: { generatedById: ids }, data: { generatedById: admin.id } });
    await tx.reportTemplate.updateMany({ where: { uploadedById: ids }, data: { uploadedById: admin.id } });
    await tx.quizQuestion.updateMany({ where: { createdById: ids }, data: { createdById: admin.id } });
    await tx.vulnerabilityChangeRequest.updateMany({ where: { requestedById: ids }, data: { requestedById: admin.id } });
    // Per-user rows can't be reassigned (one answer / score row per user) or would falsify history (audit authorship).
    await tx.quizAttempt.deleteMany({ where: { userId: ids } });
    await tx.quizUserStats.deleteMany({ where: { userId: ids } });
    await tx.patternMapScore.deleteMany({ where: { userId: ids } });
    await tx.auditLog.deleteMany({ where: { actorId: ids } });
    // Notifications cascade; optional references (reviewers, requesters, TL/manager links) null themselves via ON DELETE SET NULL.
    await tx.user.deleteMany({ where: { id: ids } });
  }

  const tl = await upsertDefault(tlDef, null);
  for (const t of testerDefs) await upsertDefault(t, tl.id);
  return admin.id;
}

async function stage<T>(i: number, n: number, name: string, log: ResetDeps['log'], fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now();
  log(`[${i}/${n}] ${name} ...`);
  try {
    const result = await fn();
    log(`[${i}/${n}] ${name} ... done (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    return result;
  } catch (e) {
    log(`[${i}/${n}] ${name} ... FAILED`);
    throw new ResetStageError(name, e);
  }
}

/** Storage keys referenced by rows we're about to delete (covers paths outside the swept prefixes). */
async function referencedFiles(prisma: PrismaClient, scopes: ResetScope[]): Promise<string[]> {
  const f = footprint(scopes);
  const keys = new Set<string>();
  if (f.findings) {
    for (const x of await prisma.finding.findMany({ select: { evidencePaths: true } })) x.evidencePaths.forEach((k) => keys.add(k));
    for (const x of await prisma.pocStep.findMany({ where: { imagePath: { not: null } }, select: { imagePath: true } })) keys.add(x.imagePath!);
  }
  if (f.projects) {
    for (const x of await prisma.project.findMany({ select: { reportDocxPath: true, reportPdfPath: true } })) {
      if (x.reportDocxPath) keys.add(x.reportDocxPath);
      if (x.reportPdfPath) keys.add(x.reportPdfPath);
    }
    for (const x of await prisma.reportGeneration.findMany({ select: { docxPath: true, pdfPath: true } })) {
      if (x.docxPath) keys.add(x.docxPath);
      if (x.pdfPath) keys.add(x.pdfPath);
    }
  }
  return [...keys];
}

/**
 * Runs the selected resets. Order: DB (one transaction — all or nothing) →
 * storage → cache. A DB failure rolls back and changes nothing; a later-stage
 * failure leaves the DB reset and is safe to re-run (every stage is idempotent).
 */
export async function runReset(deps: ResetDeps, scopes: ResetScope[]): Promise<void> {
  const { prisma, storage, cache, log } = deps;
  const f = footprint(scopes);
  const stages = ['Prepare defaults', 'Reset database', ...(f.storagePrefixes.length ? ['Clean stored files'] : []), ...(f.sessions || f.queue ? ['Clean sessions & queue'] : [])];
  let i = 0;
  const n = stages.length;

  const { hashes, vulns, files } = await stage(++i, n, 'Prepare defaults', log, async () => ({
    hashes: f.users ? await hashDefaultPasswords() : {},
    vulns: f.vulns ? loadDefaultVulnerabilities() : [],
    files: await referencedFiles(prisma, scopes),
  }));

  await stage(++i, n, 'Reset database', log, () =>
    prisma.$transaction((tx) => resetDatabase(tx, scopes, hashes, vulns), { timeout: 10 * 60_000, maxWait: 30_000 }),
  );

  if (f.storagePrefixes.length) {
    await stage(++i, n, 'Clean stored files', log, async () => {
      // Referenced paths cover files outside the swept prefixes; listed ones are what actually exists.
      const keys = new Set(files);
      const existing = new Set<string>();
      for (const p of f.storagePrefixes) for (const k of await storage.list(p)) { keys.add(k); existing.add(k); }
      if (keys.size) await storage.remove([...keys]);
      // Verify nothing was left behind.
      const left: string[] = [];
      for (const p of f.storagePrefixes) left.push(...(await storage.list(p)));
      if (left.length) throw new Error(`${left.length} stored file(s) remain, e.g. ${left[0]}`);
      log(`      removed ${existing.size} stored file(s)`);
    });
  }

  if (f.sessions || f.queue) {
    await stage(++i, n, 'Clean sessions & queue', log, async () => {
      if (f.sessions) log(`      cleared ${await cache.clearSessionKeys()} session key(s)`);
      if (f.queue) await cache.clearReportQueue();
    });
  }
}
