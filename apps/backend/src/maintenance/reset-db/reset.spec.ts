import { ResetScope } from './scopes';
import { ResetStageError, footprint, runReset } from './reset';

/** Records every `model.method` call made inside the transaction, in order. */
function makeHarness(opts: { failTx?: boolean; storage?: Record<string, string[]> } = {}) {
  const calls: string[] = [];
  const model = (name: string) =>
    new Proxy({}, {
      get: (_t, method: string) => async (args?: any) => {
        calls.push(`${name}.${method}`);
        if (opts.failTx && name === 'project' && method === 'deleteMany') throw new Error('boom');
        if (method === 'upsert' || method === 'findUnique') return { id: `${name}-id` };
        if (method === 'findMany') return name === 'user' ? [{ id: 'old-user' }] : [];
        return { count: 0 };
      },
    });
  const tx = new Proxy({}, { get: (_t, name: string) => model(name) });
  const prisma: any = new Proxy(
    { $transaction: async (fn: any) => fn(tx) },
    { get: (target: any, name: string) => (name in target ? target[name] : model(name)) },
  );

  const stored = new Set(Object.values(opts.storage ?? {}).flat());
  const storage = {
    list: jest.fn(async (prefix: string) => [...stored].filter((k) => k.startsWith(prefix))),
    remove: jest.fn(async (keys: string[]) => keys.forEach((k) => stored.delete(k))),
  };
  const cache = { clearSessionKeys: jest.fn(async () => 3), clearReportQueue: jest.fn(async () => undefined) };
  const logs: string[] = [];
  return { prisma, storage, cache, calls, logs, stored, deps: { prisma, storage, cache, log: (m: string) => logs.push(m) } };
}

const touched = (calls: string[]) => new Set(calls.filter((c) => c.endsWith('.deleteMany')).map((c) => c.split('.')[0]));

describe('footprint', () => {
  it('Everything expands to every store', () => {
    const f = footprint(['everything']);
    expect(f).toMatchObject({ quiz: true, projects: true, vulns: true, users: true, findings: true, sessions: true, queue: true });
    expect(f.storagePrefixes).toEqual(['']);
  });
  it('a vulnerability reset also clears findings (they cannot exist without vulnerabilities) but not projects', () => {
    const f = footprint(['vulnerabilities']);
    expect(f).toMatchObject({ vulns: true, findings: true, projects: false });
    expect(f.storagePrefixes).toEqual(['poc/']);
  });
});

describe('runReset — each scope touches only what it should', () => {
  it('quiz: only quiz tables + quiz notifications', async () => {
    const h = makeHarness();
    await runReset(h.deps, ['quiz']);
    expect(touched(h.calls)).toEqual(new Set(['quizAttempt', 'quizUserStats', 'quizQuestion', 'notification']));
    expect(h.storage.remove).not.toHaveBeenCalled();
    expect(h.cache.clearSessionKeys).not.toHaveBeenCalled();
  });

  it('projects: projects, findings, reports, files, queue — never users, vulnerabilities or templates', async () => {
    const h = makeHarness({ storage: { f: ['poc/a.png', 'reports/p1/r.docx', 'templates/t.docx'] } });
    await runReset(h.deps, ['projects']);
    const t = touched(h.calls);
    expect(t).toEqual(new Set(['pocStep', 'finding', 'reportGeneration', 'project']));
    expect(h.stored).toEqual(new Set(['templates/t.docx'])); // templates survive
    expect(h.cache.clearReportQueue).toHaveBeenCalled();
    expect(h.cache.clearSessionKeys).not.toHaveBeenCalled();
  });

  it('vulnerabilities: vulns, change requests, findings, re-imports the dataset', async () => {
    const h = makeHarness();
    await runReset(h.deps, ['vulnerabilities']);
    expect(touched(h.calls)).toEqual(new Set(['pocStep', 'finding', 'vulnerabilityChangeRequest', 'vulnerability', 'notification']));
    expect(h.calls).toContain('vulnerability.createMany');
    expect(h.calls).not.toContain('project.deleteMany');
  });

  it('users: removes non-default users after reassigning survivors, signs sessions out, deletes no projects', async () => {
    const h = makeHarness();
    await runReset(h.deps, ['users']);
    expect(h.calls).not.toContain('project.deleteMany');
    expect(h.calls).toContain('project.updateMany'); // reassigned, not deleted
    expect(h.calls.indexOf('project.updateMany')).toBeLessThan(h.calls.indexOf('user.deleteMany'));
    expect(h.calls.filter((c) => c === 'user.upsert')).toHaveLength(4); // admin, teamlead, 2 testers
    expect(h.cache.clearSessionKeys).toHaveBeenCalled();
  });

  it('everything: clears all stores and the whole bucket, then restores defaults', async () => {
    const h = makeHarness({ storage: { f: ['poc/a', 'reports/p/r', 'templates/t', 'other/x'] } });
    await runReset(h.deps, ['everything']);
    expect(touched(h.calls)).toEqual(
      new Set(['quizAttempt', 'quizUserStats', 'quizQuestion', 'notification', 'pocStep', 'finding', 'reportGeneration', 'project',
        'vulnerabilityChangeRequest', 'vulnerability', 'templateField', 'reportTemplate', 'auditLog', 'appSettings', 'user']),
    );
    expect(h.stored.size).toBe(0);
    expect(h.calls).toContain('vulnerability.createMany');
    expect(h.calls.filter((c) => c === 'user.upsert')).toHaveLength(4);
    expect(h.calls.filter((c) => c === 'auditLog.create')).toHaveLength(1); // trace of the reset itself
  });

  it('multiple scopes run in one pass, in dependency-safe order (projects before users)', async () => {
    const h = makeHarness();
    await runReset(h.deps, ['users', 'projects']);
    expect(h.calls.indexOf('project.deleteMany')).toBeLessThan(h.calls.indexOf('user.deleteMany'));
  });
});

describe('runReset — failure handling', () => {
  it('a database failure names the stage and never touches files or cache', async () => {
    const h = makeHarness({ failTx: true, storage: { f: ['poc/a'] } });
    const err = await runReset(h.deps, ['projects']).catch((e) => e);
    expect(err).toBeInstanceOf(ResetStageError);
    expect(err.stage).toBe('Reset database');
    expect(h.storage.remove).not.toHaveBeenCalled();
    expect(h.cache.clearReportQueue).not.toHaveBeenCalled();
    expect(h.stored.has('poc/a')).toBe(true);
  });

  it('fails the stage if files remain after cleanup (no silent orphans)', async () => {
    const h = makeHarness({ storage: { f: ['poc/stuck'] } });
    h.storage.remove.mockImplementation(async () => undefined); // removal silently does nothing
    const err = await runReset(h.deps, ['projects']).catch((e) => e);
    expect(err).toBeInstanceOf(ResetStageError);
    expect(err.stage).toBe('Clean stored files');
  });

  it('reports progress per stage', async () => {
    const h = makeHarness();
    await runReset(h.deps, ['projects']);
    expect(h.logs.filter((l) => l.endsWith('done') || l.includes('done ('))).toHaveLength(4);
    expect(h.logs[0]).toMatch(/^\[1\/4\]/);
  });
});
