import { UserRole } from '@prisma/client';
import { UsersService } from './users.service';

// Login matches emails ignoring case, so accounts that differ only by case must not be creatable.
describe('user create/update: duplicate check ignores case', () => {
  it('asks the database for a case-insensitive match on username and email', async () => {
    const prisma: any = { user: { findFirst: jest.fn().mockResolvedValue({ id: 'x' }), findUnique: jest.fn().mockResolvedValue({ id: 'u', role: UserRole.TESTER, assignedTlId: 'tl' }) } };
    const svc = new UsersService(prisma, { log: jest.fn() } as any, {} as any, {} as any, {} as any);
    await expect(svc.create({ username: 'Alice', email: 'A@X.com', role: UserRole.TESTER } as any, 'tl', 'ip', 'ua', UserRole.TEAM_LEAD)).rejects.toThrow(/already exists/);
    expect(prisma.user.findFirst.mock.calls[0][0].where.OR).toEqual([
      { username: { equals: 'Alice', mode: 'insensitive' } },
      { email: { equals: 'A@X.com', mode: 'insensitive' } },
    ]);
    await expect(svc.update('u', { email: 'B@X.com' } as any, 'tl', 'ip', 'ua', UserRole.TEAM_LEAD)).rejects.toThrow(/already exists/);
    expect(prisma.user.findFirst.mock.calls[1][0].where.OR[0]).toEqual({ email: { equals: 'B@X.com', mode: 'insensitive' } });
  });
});
