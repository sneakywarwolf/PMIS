// Pattern Map difficulty logic. Pure (randomness injectable) so it can be tested with `npm test`.

export type Cfg = { grid: number; length: number; step: number; label: string };
type Rand = () => number;

// Rounds 1-6: a gentle fixed ramp. From round 7 every round rolls a random tier,
// so a super-easy round can follow a super-tough one.
export const RAMP: Cfg[] = [
  { grid: 3, length: 3, step: 650, label: 'Warm-up' },
  { grid: 3, length: 4, step: 620, label: 'Warm-up' },
  { grid: 3, length: 4, step: 580, label: 'Easy' },
  { grid: 4, length: 4, step: 560, label: 'Easy' },
  { grid: 4, length: 5, step: 520, label: 'Getting warmer' },
  { grid: 4, length: 5, step: 500, label: 'Getting warmer' },
];

const between = (rand: Rand, lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));

export const TIERS: ((rand: Rand) => Cfg)[] = [
  () => ({ grid: 3, length: 3, step: 700, label: 'Super easy' }),
  (r) => ({ grid: 3, length: between(r, 4, 5), step: 600, label: 'Easy' }),
  (r) => ({ grid: 4, length: between(r, 5, 7), step: 450, label: 'Medium' }),
  (r) => ({ grid: 5, length: between(r, 5, 7), step: 330, label: 'Tough' }),
  (r) => ({ grid: 5, length: between(r, 8, 11), step: 240, label: 'Super tough' }),
];

export const cfgFor = (n: number, rand: Rand = Math.random): Cfg =>
  RAMP[n - 1] ?? TIERS[between(rand, 0, TIERS.length - 1)](rand);

/** `cfg.length` distinct tiles of the grid, in a random order (the order to recall). */
export function makePattern(cfg: Cfg, rand: Rand = Math.random): number[] {
  const tiles = Array.from({ length: cfg.grid ** 2 }, (_, i) => i);
  for (let i = tiles.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
  }
  return tiles.slice(0, cfg.length);
}
