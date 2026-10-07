import { HttpException } from '@nestjs/common';
import { ArcadeService, startOfWeek } from './arcade.service';

describe('startOfWeek', () => {
  it('returns Monday 00:00 UTC for any day in that week', () => {
    for (const day of ['2026-10-05T00:00:00Z', '2026-10-07T15:30:00Z', '2026-10-11T23:59:59Z']) {
      expect(startOfWeek(new Date(day)).toISOString()).toBe('2026-10-05T00:00:00.000Z');
    }
  });
});

describe('ArcadeService.submit rate limit', () => {
  const dto = { rounds: [{ grid: 3, length: 3, ms: 2000 }], clicks: 3, correctClicks: 3 };

  it('rejects a second score within the minimum interval', async () => {
    const prisma: any = { patternMapScore: { findFirst: jest.fn().mockResolvedValue({ createdAt: new Date() }), create: jest.fn() } };
    await expect(new ArcadeService(prisma).submit('u1', dto)).rejects.toBeInstanceOf(HttpException);
    expect(prisma.patternMapScore.create).not.toHaveBeenCalled();
  });

  it('accepts a score when the previous one is old enough', async () => {
    const prisma: any = {
      patternMapScore: {
        findFirst: jest.fn().mockResolvedValue({ createdAt: new Date(Date.now() - 60_000) }),
        create: jest.fn().mockResolvedValue({ score: 50, accuracy: 100, roundsCleared: 1 }),
        aggregate: jest.fn().mockResolvedValue({ _max: { score: 50 } }),
      },
    };
    await expect(new ArcadeService(prisma).submit('u1', dto)).resolves.toMatchObject({ best: 50 });
  });
});
