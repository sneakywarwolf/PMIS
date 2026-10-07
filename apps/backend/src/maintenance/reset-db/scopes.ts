/**
 * Reset scopes and menu parsing for the admin/dev "Reset Application" utility
 * (prisma/reset-db.ts). Pure logic — no I/O — so it's unit-testable.
 * Nothing under src/maintenance is imported by AppModule: it's inert at runtime.
 */
export const CONCRETE_SCOPES = ['users', 'vulnerabilities', 'projects', 'quiz'] as const;
export type ConcreteScope = (typeof CONCRETE_SCOPES)[number];
export type ResetScope = ConcreteScope | 'everything';

/** Menu number → scope. 6 is Cancel. */
export const MENU: { n: number; scope: ResetScope; label: string }[] = [
  { n: 1, scope: 'users', label: 'Reset Users' },
  { n: 2, scope: 'vulnerabilities', label: 'Reset Vulnerability DB' },
  { n: 3, scope: 'projects', label: 'Reset Projects' },
  { n: 4, scope: 'quiz', label: 'Reset Quiz & Arcade Scores' },
  { n: 5, scope: 'everything', label: 'Reset Everything' },
];
export const CANCEL_N = 6;

export type Selection = { cancel: true } | { scopes: ResetScope[] } | { error: string };

/**
 * "1,3", "1 3", "2" → scopes. Choosing 5 means everything (the rest are
 * redundant); 6 anywhere cancels; anything else is an error — never guess.
 */
export function parseSelection(input: string): Selection {
  const tokens = input.split(/[\s,]+/).filter(Boolean);
  if (tokens.length === 0) return { error: 'Enter at least one option number (1-6).' };

  const nums: number[] = [];
  for (const t of tokens) {
    if (!/^\d+$/.test(t)) return { error: `"${t}" is not a valid option.` };
    const n = Number(t);
    if (n < 1 || n > CANCEL_N) return { error: `"${t}" is not a valid option (1-${CANCEL_N}).` };
    nums.push(n);
  }

  if (nums.includes(CANCEL_N)) return { cancel: true };
  if (nums.includes(5)) return { scopes: ['everything'] };
  return { scopes: MENU.filter((m) => nums.includes(m.n)).map((m) => m.scope) };
}

const NAME_ALIASES: Record<string, ResetScope> = {
  users: 'users',
  vulnerabilities: 'vulnerabilities',
  vulns: 'vulnerabilities',
  vuln: 'vulnerabilities',
  projects: 'projects',
  quiz: 'quiz',
  everything: 'everything',
  all: 'everything',
};

/** `--scopes users,projects` (non-interactive). Unknown names are an error. */
export function parseScopeNames(csv: string): Selection {
  const names = csv.split(/[\s,]+/).filter(Boolean).map((s) => s.toLowerCase());
  if (names.length === 0) return { error: 'No scopes given.' };
  const scopes: ResetScope[] = [];
  for (const n of names) {
    const scope = NAME_ALIASES[n];
    if (!scope) return { error: `Unknown scope "${n}". Use: users, vulnerabilities, projects, quiz, everything.` };
    if (!scopes.includes(scope)) scopes.push(scope);
  }
  if (scopes.includes('everything')) return { scopes: ['everything'] };
  return { scopes: CONCRETE_SCOPES.filter((s) => scopes.includes(s)) };
}

export const isEverything = (scopes: ResetScope[]) => scopes.includes('everything');
