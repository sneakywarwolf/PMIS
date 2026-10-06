import * as fs from 'fs';
import * as path from 'path';
import { DEFAULT_USERS, loadDefaultVulnerabilities } from './defaults';

const seed = fs.readFileSync(path.resolve(__dirname, '../../../prisma/seed.ts'), 'utf-8');

describe('reset defaults stay in sync with prisma/seed.ts', () => {
  it.each(DEFAULT_USERS.map((u) => [u.username, u]))('account %s matches the seed', (_name, u: any) => {
    expect(seed).toContain(`username: '${u.username}'`);
    expect(seed).toContain(`email: '${u.email}'`);
    expect(seed).toContain(`'${u.password}'`);
    expect(seed).toContain(`role: UserRole.${u.role}`);
  });

  it('testers are under the team lead in both', () => {
    expect(DEFAULT_USERS.filter((u) => u.underTeamLead).map((u) => u.username)).toEqual(['tester1', 'tester2']);
    expect(seed.match(/assignedTlId: tl\.id/g)).toHaveLength(2);
  });

  it('keeps one entry per name (first wins), exactly like the seed', () => {
    const raw: { name: string }[] = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../prisma/vulnerabilities.json'), 'utf-8'));
    const firstByName = new Map<string, number>();
    raw.forEach((v, i) => firstByName.has(v.name) || firstByName.set(v.name, i));

    const loaded = loadDefaultVulnerabilities();
    expect(loaded).toHaveLength(firstByName.size);
    expect(new Set(loaded.map((v) => v.name)).size).toBe(loaded.length);
    expect(loaded.map((v) => v.name)).toEqual([...firstByName.keys()]);
    expect(seed).toContain('where: { name: vuln.name }'); // the seed's dedupe rule this mirrors
  });

  it('the vulnerability dataset loads and every entry has the required fields', () => {
    const vulns = loadDefaultVulnerabilities();
    expect(vulns.length).toBeGreaterThan(100);
    for (const v of vulns) {
      for (const k of ['name', 'severity', 'description', 'impact', 'remediation', 'references'] as const) {
        expect(typeof v[k]).toBe('string');
      }
    }
    // The seed reads the same file.
    expect(seed).toContain("'vulnerabilities.json'");
  });
});
