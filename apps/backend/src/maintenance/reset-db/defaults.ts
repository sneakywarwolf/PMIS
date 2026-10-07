import * as argon2 from 'argon2';
import * as fs from 'fs';
import * as path from 'path';
import { UserRole } from '@prisma/client';

/**
 * Default accounts and vulnerability dataset restored by the reset utility.
 *
 * These deliberately mirror prisma/seed.ts (which is left untouched — it isn't
 * idempotent for sample projects, so it can't be reused after a reset).
 * defaults.spec.ts fails if the two drift apart.
 */
export const DEFAULT_USERS = [
  { username: 'admin', email: 'admin@vapt.local', role: UserRole.ADMIN, password: 'Admin@1234567890!', underTeamLead: false },
  { username: 'teamlead', email: 'tl@vapt.local', role: UserRole.TEAM_LEAD, password: 'Tl@1234567890!', underTeamLead: false },
  { username: 'tester1', email: 'tester1@vapt.local', role: UserRole.TESTER, password: 'Tester@1234567890!', underTeamLead: true },
  { username: 'tester2', email: 'tester2@vapt.local', role: UserRole.TESTER, password: 'Tester@1234567890!', underTeamLead: true },
] as const;

export const DEFAULT_ADMIN_USERNAME = 'admin';
export const DEFAULT_TEAM_LEAD_USERNAME = 'teamlead';
export const DEFAULT_USERNAMES: string[] = DEFAULT_USERS.map((u) => u.username);

// Same hashing parameters as prisma/seed.ts and the app's own password hashing.
const ARGON2_OPTIONS = { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 4 };

/** Hashed up front (slow) so the DB transaction itself stays short. */
export async function hashDefaultPasswords(): Promise<Record<string, string>> {
  const cache = new Map<string, string>();
  const out: Record<string, string> = {};
  for (const u of DEFAULT_USERS) {
    if (!cache.has(u.password)) cache.set(u.password, await argon2.hash(u.password, ARGON2_OPTIONS));
    out[u.username] = cache.get(u.password)!;
  }
  return out;
}

export interface SeedVulnerability {
  name: string;
  severity: string;
  cvssScore?: number | null;
  cvssVector?: string | null;
  description: string;
  impact: string;
  remediation: string;
  references: string;
}

/**
 * Same result as prisma/seed.ts: the file has repeated names and the seed
 * keeps only the first entry per name (`findFirst({ where: { name } })`).
 */
export function loadDefaultVulnerabilities(file = path.resolve(__dirname, '../../../prisma/vulnerabilities.json')): SeedVulnerability[] {
  const all: SeedVulnerability[] = JSON.parse(fs.readFileSync(file, 'utf-8'));
  const seen = new Set<string>();
  return all.filter((v) => !seen.has(v.name) && !!seen.add(v.name));
}
