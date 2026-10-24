import { readFileSync } from 'fs';
import { join } from 'path';
import { CANONICAL_TEMPLATE_PARAMETERS } from './template-parameters';

// The docs site lists every mappable parameter; fail when the list and the code drift apart.
describe('docs site parameter table', () => {
  const html = readFileSync(join(__dirname, '../../../../site/reports.html'), 'utf8');
  const documented = [...html.matchAll(/<tr data-key="([^"]+)"/g)].map((m) => m[1]).sort();
  const canonical = CANONICAL_TEMPLATE_PARAMETERS.map((p) => p.key).sort();

  it('documents exactly the canonical parameters', () => {
    expect(documented).toEqual(canonical);
  });
});
