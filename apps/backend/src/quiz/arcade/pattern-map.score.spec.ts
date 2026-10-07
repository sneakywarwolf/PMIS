import { scoreRun } from './pattern-map.score';

describe('scoreRun', () => {
  const r = (grid: number, length: number, ms = 3000) => ({ grid, length, ms });

  it('rewards difficulty, accuracy, speed and rounds', () => {
    const base = scoreRun([r(3, 3)], 3, 3)!.score;
    expect(scoreRun([r(4, 3)], 3, 3)!.score).toBeGreaterThan(base);
    expect(scoreRun([r(3, 3, 500)], 3, 3)!.score).toBeGreaterThan(base);
    expect(scoreRun([r(3, 3)], 5, 3)!.score).toBeLessThan(base);
    expect(scoreRun([r(3, 3), r(3, 4)], 7, 7)!.score).toBeGreaterThan(base);
  });

  it('rejects impossible runs', () => {
    expect(scoreRun([r(6, 3)], 3, 3)).toBeNull();
    expect(scoreRun([r(3, 3)], 3, 4)).toBeNull();
    expect(scoreRun([r(3, 3)], 2, 2)).toBeNull(); // fewer correct clicks than the cleared pattern needs
  });
});
