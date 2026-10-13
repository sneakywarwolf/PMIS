import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { assertSafeDocx } from './docx-package.util';

const root = join(__dirname, '../../../../Report Template');
describe('real templates', () => {
  for (const d of ['PCI', 'VAPT']) {
    for (const f of readdirSync(join(root, d))) {
      it(`${d}/${f.slice(0, 40)}`, async () => {
        await expect(assertSafeDocx(readFileSync(join(root, d, f)))).resolves.toBeUndefined();
      });
    }
  }
});
