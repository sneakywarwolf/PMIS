import * as fs from 'fs';
import * as path from 'path';

// The container runs `prisma db seed` on EVERY start. The default vulnerability library is a first-install default: it must not be
// re-created on later starts, or entries an Admin deleted, renamed or replaced (bulk upload) would quietly come back.
// (Behaviour was verified against a real database; this pins the rule in the seed itself.)
describe('prisma/seed.ts: default library is seeded on first install only', () => {
  const seed = fs.readFileSync(path.resolve(__dirname, '../../prisma/seed.ts'), 'utf-8').replace(/\r\n/g, '\n');
  const libraryBlock = seed.slice(seed.indexOf('const existingLibrary'), seed.indexOf('Demo data'));

  it('counts the library first, and only imports when it is empty', () => {
    expect(libraryBlock).toMatch(/const existingLibrary = await prisma\.vulnerability\.count\(\)/);
    expect(libraryBlock).toMatch(/if \(existingLibrary > 0\) \{[\s\S]*left as it is[\s\S]*\} else \{[\s\S]*vulnerabilities\.json/);
  });

  it('the import (and its per-name de-duplication that the reset tool mirrors) sits inside the empty-library branch only', () => {
    const elseAt = libraryBlock.indexOf('} else {');
    expect(elseAt).toBeGreaterThan(0);
    expect(libraryBlock.slice(0, elseAt)).not.toMatch(/vulnerability\.create/);
    expect(libraryBlock.slice(elseAt)).toContain('where: { name: vuln.name }');
  });

  it('counts every row, inactive ones too (a library an Admin emptied by deleting is still theirs)', () => {
    expect(libraryBlock).not.toMatch(/count\(\s*\{/); // no filter on isActive or status
  });
});
