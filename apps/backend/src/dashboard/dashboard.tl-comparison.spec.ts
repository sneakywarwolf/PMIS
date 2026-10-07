import { Test } from '@nestjs/testing';
import { DashboardService } from './dashboard.service';
import { PrismaService } from '../prisma/prisma.service';
import { DashboardController } from './dashboard.controller';

describe('DashboardService.getTlComparison', () => {
  let service: DashboardService;

  beforeEach(async () => {
    const prisma = {
      user: {
        // first call = TLs, second = testers (Promise.all keeps call order)
        findMany: jest
          .fn()
          .mockResolvedValueOnce([
            { id: 'tl2', username: 'zed', fullName: null },
            { id: 'tl1', username: 'amy', fullName: 'Amy Adams' },
          ])
          .mockResolvedValueOnce([
            { id: 't1', assignedTlId: 'tl1' },
            { id: 't2', assignedTlId: 'tl2' }, // moved from tl1 to tl2
          ]),
      },
      project: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'p1', status: 'COMPLETED', testerId: 't1', tlId: 'tl1' },
          { id: 'p2', status: 'IN_PROGRESS', testerId: 't2', tlId: 'tl1' }, // owned by tl2 now
          { id: 'p3', status: 'IN_PROGRESS', testerId: 'gone', tlId: 'unknown-tl' }, // no team → ignored
        ]),
      },
      finding: {
        findMany: jest.fn().mockResolvedValue([
          { projectId: 'p1', vulnerability: { severity: 'Critical' } },
          { projectId: 'p2', vulnerability: { severity: 'informational' } },
          { projectId: 'p3', vulnerability: { severity: 'High' } },
        ]),
      },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [DashboardService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(DashboardService);
  });

  it('buckets projects/findings by the tester\'s current TL and sorts by name', async () => {
    const result = await service.getTlComparison();

    expect(result.map((t) => t.tlName)).toEqual(['Amy Adams', 'zed']);
    const [amy, zed] = result;
    expect(amy).toMatchObject({ teamSize: 1, total: 1, byStatus: { COMPLETED: 1, IN_PROGRESS: 0 }, vulnCounts: { critical: 1, info: 0 } });
    expect(zed).toMatchObject({ teamSize: 1, total: 1, byStatus: { IN_PROGRESS: 1 }, vulnCounts: { critical: 0, info: 1 } });
  });

  it('is restricted to ADMIN/AVP on the controller', () => {
    const roles = Reflect.getMetadata('roles', DashboardController.prototype.getTlComparison);
    expect([...roles].sort()).toEqual(['ADMIN', 'AVP']);
  });
});
