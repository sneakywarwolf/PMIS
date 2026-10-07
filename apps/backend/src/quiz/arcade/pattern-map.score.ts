export type PatternRound = { grid: number; length: number; ms: number };

const MAX_ROUNDS = 100;
const MAX_ROUND_MS = 60_000;

/** Returns null when the submitted run is impossible (tampered/garbled), else the final score. */
export function scoreRun(rounds: PatternRound[], clicks: number, correctClicks: number): { score: number; accuracy: number } | null {
  if (rounds.length > MAX_ROUNDS || correctClicks > clicks) return null;
  let score = 0;
  let expectedCorrect = 0;
  for (const r of rounds) {
    if (r.grid < 3 || r.grid > 5 || r.length < 1 || r.length > r.grid * r.grid || r.ms < 0 || r.ms > MAX_ROUND_MS) return null;
    const mult = r.grid - 2; // 3x3 = 1, 4x4 = 2, 5x5 = 3
    const speed = Math.max(0, 10 - Math.floor(r.ms / 1000)); // faster recall earns up to +10
    score += (r.length * 10 + speed) * mult;
    expectedCorrect += r.length;
  }
  if (correctClicks < expectedCorrect) return null;
  const accuracy = clicks ? Math.round((correctClicks / clicks) * 100) : 0;
  return { score: Math.round(score * (0.5 + accuracy / 200)), accuracy }; // 50%..100% of raw by accuracy
}
