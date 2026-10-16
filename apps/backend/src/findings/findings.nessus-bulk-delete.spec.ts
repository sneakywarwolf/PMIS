import { ForbiddenException } from '@nestjs/common';
import { FindingsService } from './findings.service';

function setup(opts: { role?: string; userId?: string; targets?: any[]; stillUsedSteps?: any[]; stillUsedEvidence?: any[] } = {}) {
  const tx: any = {
    $queryRaw: jest.fn(),
    finding: {
      findMany: jest.fn().mockImplementation(({ where }: any) =>
        // 1st call selects the targets; the later one is the "still referenced" check on evidence paths
        where.evidencePaths ? Promise.resolve(opts.stillUsedEvidence ?? []) : Promise.resolve(opts.targets ?? []),
      ),
      deleteMany: jest.fn().mockImplementation(({ where }: any) => Promise.resolve({ count: where.id.in.length })),
      count: jest.fn(),
    },
    projectVulnerability: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    pocStep: { findMany: jest.fn().mockResolvedValue(opts.stillUsedSteps ?? []) },
  };
  const prisma: any = {
    ...tx,
    project: { findUnique: jest.fn().mockResolvedValue({ id: 'p1', testerId: 'u1', tlId: 'tl1', tester: { assignedTlId: 'tl1' } }) },
    $transaction: jest.fn((fn: any) => fn(tx)),
  };
  const audit: any = { log: jest.fn() };
  const storage: any = { deleteFile: jest.fn().mockResolvedValue(undefined) };
  const user: any = { id: opts.userId ?? 'u1', role: opts.role ?? 'TESTER' };
  return { svc: new FindingsService(prisma, audit, storage), prisma, tx, audit, storage, user };
}

const finding = (id: string, imagePaths: string[] = [], evidencePaths: string[] = []) => ({
  id, evidencePaths, pocSteps: imagePaths.map((imagePath) => ({ imagePath })),
});

describe('FindingsService.removeAllNessusFindings', () => {
  it('deletes every matching finding in one transaction (not just a page), then their unused records, and audits it', async () => {
    const targets = Array.from({ length: 300 }, (_, i) => finding(`f${i}`));
    const { svc, prisma, tx, audit, user } = setup({ targets });

    await expect(svc.removeAllNessusFindings('p1', user, 'ip', 'ua')).resolves.toEqual({ deleted: 300 });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw).toHaveBeenCalled(); // project row locked
    expect(tx.finding.deleteMany.mock.calls[0][0].where.id.in).toHaveLength(300);
    expect(tx.projectVulnerability.deleteMany).toHaveBeenCalledWith({ where: { projectId: 'p1', source: 'nessus', findings: { none: {} } } });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      actorId: 'u1', targetType: 'PROJECT', targetId: 'p1', details: { bulkDeleteNessusFindings: true, deletedCount: 300 },
    }));
  });

  it('selects by the project-scoped record\'s source, never by name or severity, and only this project', async () => {
    const { svc, tx, user } = setup({ role: 'ADMIN', userId: 'admin' });
    await svc.removeAllNessusFindings('p1', user, 'ip', 'ua');
    expect(tx.finding.findMany.mock.calls[0][0].where).toEqual({ projectId: 'p1', projectVulnerability: { is: { projectId: 'p1', source: 'nessus' } } });
  });

  it('limits a tester to findings they created (same rule as single delete)', async () => {
    const { svc, tx, user } = setup({ role: 'TESTER', userId: 'u1' });
    await svc.removeAllNessusFindings('p1', user, 'ip', 'ua');
    expect(tx.finding.findMany.mock.calls[0][0].where.createdById).toBe('u1');
  });

  it('is safe to repeat: nothing left means 0 deleted, no audit entry, no file removal', async () => {
    const { svc, tx, audit, storage, user } = setup({ targets: [] });
    await expect(svc.removeAllNessusFindings('p1', user, 'ip', 'ua')).resolves.toEqual({ deleted: 0 });
    expect(tx.finding.deleteMany).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
    expect(storage.deleteFile).not.toHaveBeenCalled();
  });

  it('removes only files nothing else still references', async () => {
    const { svc, storage, user } = setup({
      targets: [finding('f1', ['poc/own.png', 'poc/shared.png'], ['ev/own.pdf', 'ev/shared.pdf'])],
      stillUsedSteps: [{ imagePath: 'poc/shared.png' }],
      stillUsedEvidence: [{ evidencePaths: ['ev/shared.pdf'] }],
    });
    await svc.removeAllNessusFindings('p1', user, 'ip', 'ua');
    expect(storage.deleteFile.mock.calls.map((c: any[]) => c[0]).sort()).toEqual(['ev/own.pdf', 'poc/own.png']);
  });

  it('a failed transaction deletes no files and reports no success', async () => {
    const { svc, prisma, storage, user } = setup({ targets: [finding('f1', ['poc/a.png'])] });
    prisma.$transaction.mockRejectedValue(new Error('db down'));
    await expect(svc.removeAllNessusFindings('p1', user, 'ip', 'ua')).rejects.toThrow('db down');
    expect(storage.deleteFile).not.toHaveBeenCalled();
  });

  it('a storage failure after commit does not fail the delete', async () => {
    const { svc, storage, user } = setup({ targets: [finding('f1', ['poc/a.png'])] });
    storage.deleteFile.mockRejectedValue(new Error('minio down'));
    await expect(svc.removeAllNessusFindings('p1', user, 'ip', 'ua')).resolves.toEqual({ deleted: 1 });
  });

  it('keeps project-level authorization: another tester\'s project is refused before anything is read', async () => {
    const { svc, prisma, user } = setup({ role: 'TESTER', userId: 'someone-else' });
    await expect(svc.removeAllNessusFindings('p1', user, 'ip', 'ua')).rejects.toThrow(ForbiddenException);
    await expect(svc.countNessusFindings('p1', user)).rejects.toThrow(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('count uses the same scope as the delete', async () => {
    const { svc, tx, user } = setup({ role: 'ADMIN', userId: 'admin' });
    tx.finding.count.mockResolvedValue(412);
    await expect(svc.countNessusFindings('p1', user)).resolves.toEqual({ count: 412 });
    expect(tx.finding.count).toHaveBeenCalledWith({ where: { projectId: 'p1', projectVulnerability: { is: { projectId: 'p1', source: 'nessus' } } } });
  });
});
